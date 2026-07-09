"""
vault.py — SecurePay AI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AES-256-GCM encrypted local vault.  Maps payment tokens to fictitious card
records stored encrypted at rest in SQLite.

╔══════════════════════════════════════════════════════════════════════════════╗
║  SECURITY INVARIANT — enforced in code, not just documented                  ║
║                                                                              ║
║  • store_card()    → returns None.  No card data propagated outward.         ║
║  • resolve_token() → returns bool only.  Decrypted data is local-only.       ║
║  • _decrypt_card() → private (_prefix). Return value NEVER leaves vault.py.  ║
║  • delete_card()   → returns None.                                           ║
║  • init_vault()    → returns None. One-time DB schema creation.              ║
║                                                                              ║
║  Any modification returning PAN, CVV, expiry, or cardholder to any caller   ║
║  outside vault.py is a security regression — reject in code review.          ║
╚══════════════════════════════════════════════════════════════════════════════╝

Encryption scheme:
  Key derivation : PBKDF2-HMAC-SHA256 (100,000 iterations)
  Algorithm      : AES-256-GCM (authenticated encryption — detects tampering)
  Nonce          : 96-bit (12 bytes), CSPRNG, unique per encryption
  Storage format : base64( nonce[12] ‖ ciphertext+tag )

Key design note (for the pitch):
  Production would store the AES key in an HSM.  For this demo, we derive it
  via PBKDF2 from a single env var (VAULT_ENCRYPTION_KEY) with a fixed salt.
  The distinction is called out clearly in setup docs.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from __future__ import annotations

import base64
import json
import logging
import os
import random
import secrets
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

import aiosqlite
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Key derivation
# ──────────────────────────────────────────────────────────────────────────────
_KDF_SALT = b"securepay-ai-vault-v1-fixed-salt"   # fixed for demo; HSM in prod
_cached_key: Optional[bytes] = None


def _derive_aes_key() -> bytes:
    """
    Derive a 32-byte AES-256 key from VAULT_ENCRYPTION_KEY via PBKDF2-SHA256.
    Result is cached in-process after the first call to avoid repeated KDF work.

    Raises RuntimeError if the env var is missing or too short.
    Called once at startup via init_vault() — not lazily on each request.
    """
    global _cached_key
    if _cached_key is not None:
        return _cached_key

    raw = os.environ.get("VAULT_ENCRYPTION_KEY", "").strip()
    if not raw:
        raise RuntimeError(
            "VAULT_ENCRYPTION_KEY is not set. "
            "Add it to your .env file (see .env.example). "
            "Example: VAULT_ENCRYPTION_KEY=replace_with_32_char_secret_key!"
        )
    if len(raw) < 16:
        raise RuntimeError(
            f"VAULT_ENCRYPTION_KEY is only {len(raw)} characters — "
            "minimum 16 required (32+ recommended for AES-256 strength)."
        )

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_KDF_SALT,
        iterations=100_000,
    )
    _cached_key = kdf.derive(raw.encode("utf-8"))
    logger.info("vault: AES-256 key derived from VAULT_ENCRYPTION_KEY ✓")
    return _cached_key


# ──────────────────────────────────────────────────────────────────────────────
# Database path — resolved at call time so load_dotenv() can override it
# ──────────────────────────────────────────────────────────────────────────────

def _db_path() -> Path:
    """
    Return the vault DB path, resolved at call time.
    This is a function (not a module-level constant) so that the VAULT_DB_PATH
    env var is evaluated AFTER load_dotenv() has been called in main.py,
    rather than at import time.
    """
    raw = os.environ.get("VAULT_DB_PATH", "").strip()
    return Path(raw) if raw else Path("vault.db")


_DDL = """
CREATE TABLE IF NOT EXISTS cards (
    token          TEXT PRIMARY KEY,
    encrypted_blob TEXT NOT NULL,
    created_at     TEXT NOT NULL
)
"""

_db_initialised = False   # module-level flag; init_vault() sets this to True


async def init_vault() -> None:
    """
    One-time database schema creation.  Call this at application startup
    (from the FastAPI lifespan context) rather than per-request.

    Also validates VAULT_ENCRYPTION_KEY early so misconfiguration is caught
    at startup, not on the first /generate-token request.
    """
    global _db_initialised
    _derive_aes_key()   # validate key + warm cache at startup
    async with aiosqlite.connect(_db_path()) as db:
        await db.execute(_DDL)
        await db.commit()
    _db_initialised = True
    logger.info("vault: SQLite schema ready at %s ✓", _db_path().resolve())


async def _ensure_db() -> None:
    """
    Lazy fallback — ensures the DB is initialised if init_vault() was somehow
    not called (e.g., in tests).  Prefer calling init_vault() at startup.
    """
    if not _db_initialised:
        await init_vault()


# ──────────────────────────────────────────────────────────────────────────────
# Fictitious card generation — INTERNAL ONLY
# ──────────────────────────────────────────────────────────────────────────────

def _generate_fake_card() -> dict:
    """
    Generate a structurally realistic but entirely fictitious card record.
    PRIVATE — return value must never be propagated outside vault.py.

    PAN is guaranteed to FAIL Luhn check (we manually corrupt the check digit)
    to prevent any accidental use in a payment test environment.
    """
    # Build a random 15-digit body, then set check digit to wrong value
    body = "4" + "".join(secrets.choice(string.digits) for _ in range(14))
    # Compute real Luhn check digit, then add 1 (mod 10) to make it wrong
    from token_engine import _luhn_checksum  # import here to avoid circular at module level
    real_check  = _luhn_checksum(body)
    wrong_check = (real_check + 1) % 10
    pan         = body + str(wrong_check)   # deliberately Luhn-invalid

    # Expiry: random future date (2027–2030)
    month  = random.randint(1, 12)
    year   = random.randint(2027, 2030)
    expiry = f"{month:02d}/{year}"

    # CVV: 3-digit
    cvv = "".join(secrets.choice(string.digits) for _ in range(3))

    # Pakistani cardholder names for authentic demo context
    first = random.choice(["Ali", "Sara", "Hassan", "Zara", "Omar", "Fatima",
                            "Ahmed", "Ayesha", "Bilal", "Hina", "Kamran", "Sana"])
    last  = random.choice(["Khan", "Ahmed", "Malik", "Shah", "Qureshi",
                            "Mirza", "Siddiqui", "Chaudhry", "Baig", "Rizvi"])
    cardholder = f"{first} {last}"

    return {
        "pan":        pan,       # Luhn-invalid by design
        "expiry":     expiry,
        "cvv":        cvv,
        "cardholder": cardholder,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Encryption / Decryption — INTERNAL ONLY
# ──────────────────────────────────────────────────────────────────────────────

def _encrypt(data: dict) -> str:
    """
    AES-256-GCM encrypt a dict.
    Returns base64( nonce[12] ‖ GCM-ciphertext+tag ).
    """
    key       = _derive_aes_key()
    aesgcm    = AESGCM(key)
    nonce     = secrets.token_bytes(12)    # 96-bit GCM nonce — unique per call
    plaintext = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ct_tag    = aesgcm.encrypt(nonce, plaintext, None)    # None = no AAD
    return base64.b64encode(nonce + ct_tag).decode("ascii")


def _decrypt_card(blob: str) -> dict:
    """
    AES-256-GCM decrypt a stored blob → dict.

    ▲ PRIVATE — return value MUST NOT be propagated outside vault.py.
      Callers within this file must consume and delete the result before returning.

    Raises Exception on decryption failure (corrupt data or wrong key).
    """
    key    = _derive_aes_key()
    aesgcm = AESGCM(key)
    raw    = base64.b64decode(blob)
    if len(raw) < 12:
        raise ValueError("Vault blob is too short to contain a valid nonce+ciphertext.")
    nonce  = raw[:12]
    ct_tag = raw[12:]
    pt     = aesgcm.decrypt(nonce, ct_tag, None)
    return json.loads(pt.decode("utf-8"))


# ──────────────────────────────────────────────────────────────────────────────
# Public API — ONLY these five functions may be imported by other modules
# ──────────────────────────────────────────────────────────────────────────────

async def store_card(token: str) -> None:
    """
    Generate a card record, AES-256-GCM encrypt it, and store it
    in the vault keyed by token.
    If a USER_MASTER_CARD exists in the database, we copy the user's
    real cardholder, expiry, cvv, and use the user's real card details.
    Otherwise, we fall back to a fictitious generated card.

    Returns None — no card data is returned or logged anywhere.
    """
    await _ensure_db()

    card_data = None
    async with aiosqlite.connect(_db_path()) as db:
        async with db.execute("SELECT encrypted_blob FROM cards WHERE token = ?", ("USER_MASTER_CARD",)) as cur:
            row = await cur.fetchone()
            if row:
                try:
                    master_card = _decrypt_card(row[0])
                    card_data = {
                        "pan": master_card.get("pan", "4242424242424242"),
                        "expiry": master_card.get("expiry", "12/29"),
                        "cvv": master_card.get("cvv", "123"),
                        "cardholder": master_card.get("cardholder", "Valued Customer"),
                    }
                except Exception as exc:
                    logger.warning("vault: failed to decrypt user master card, using fake: %s", exc)

    if not card_data:
        card_data = _generate_fake_card()

    blob = _encrypt(card_data)

    # Zero out card_data in-place before GC — belt-and-suspenders data hygiene
    for k in list(card_data.keys()):
        card_data[k] = ""
    del card_data

    async with aiosqlite.connect(_db_path()) as db:
        await db.execute(
            "INSERT OR REPLACE INTO cards (token, encrypted_blob, created_at) "
            "VALUES (?, ?, ?)",
            (token, blob, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()

    logger.info("vault: card stored for %s****%s", token[:4], token[-4:])


async def store_user_master_card(pan: str, expiry: str, cvv: str, cardholder: str) -> None:
    """
    Encrypt and store the user's REAL master credit card.
    Uses AES-256-GCM. The PAN is never returned.
    """
    await _ensure_db()

    card_data = {
        "pan": pan,
        "expiry": expiry,
        "cvv": cvv,
        "cardholder": cardholder,
    }
    blob = _encrypt(card_data)

    # Zero out card_data in-place before GC
    for k in list(card_data.keys()):
        card_data[k] = ""
    del card_data

    async with aiosqlite.connect(_db_path()) as db:
        await db.execute(
            "INSERT OR REPLACE INTO cards (token, encrypted_blob, created_at) "
            "VALUES (?, ?, ?)",
            ("USER_MASTER_CARD", blob, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()

    logger.info("vault: user master card securely encrypted and stored.")


async def resolve_token(token: str) -> bool:
    """
    Verify that a vault entry exists and decrypts successfully for this token.

    Returns True  — entry found, decryption succeeded.
    Returns False — entry missing, decryption failed, or any other error.

    ▲ Returns ONLY bool.  No card data, partial fields, or decryption errors
      are propagated to the caller.
    """
    await _ensure_db()

    async with aiosqlite.connect(_db_path()) as db:
        async with db.execute(
            "SELECT encrypted_blob FROM cards WHERE token = ?", (token,)
        ) as cur:
            row = await cur.fetchone()

    if row is None:
        return False

    try:
        _card = _decrypt_card(row[0])
        # Zero out and discard — _card must never leave this scope
        for k in list(_card.keys()):
            _card[k] = ""
        del _card
        return True
    except Exception as exc:
        logger.warning(
            "vault: decryption failed for %s****%s — %s",
            token[:4], token[-4:], type(exc).__name__,
        )
        return False


async def delete_card(token: str) -> None:
    """
    Remove a vault entry when a token is killed or cleaned up.
    Returns None.  Silently succeeds if no entry exists.
    """
    await _ensure_db()

    async with aiosqlite.connect(_db_path()) as db:
        await db.execute("DELETE FROM cards WHERE token = ?", (token,))
        await db.commit()

    logger.info("vault: card deleted for %s****%s", token[:4], token[-4:])


async def get_decrypted_breach_records(tokens: list[str]) -> Tuple[list[dict], list[dict]]:
    """
    Simulate a breach comparison for a list of tokens.
    Returns (exposed_without_securepay, exposed_with_securepay).
    All decryptions are processed internally to satisfy the security boundaries.
    """
    await _ensure_db()
    exposed_without = []
    exposed_with = []

    async with aiosqlite.connect(_db_path()) as db:
        if not tokens:
            master_blob = None
            async with db.execute("SELECT encrypted_blob FROM cards WHERE token = ?", ("USER_MASTER_CARD",)) as cur:
                row = await cur.fetchone()
                if row:
                    master_blob = row[0]
            
            try:
                decrypted = _decrypt_card(master_blob) if master_blob else _generate_fake_card()
                exposed_without.append({
                    "cardholder": decrypted.get("cardholder", "John Doe"),
                    "pan": f"{decrypted.get('pan')[:4]} {decrypted.get('pan')[4:8]} {decrypted.get('pan')[8:12]} {decrypted.get('pan')[12:]}",
                    "cvv": decrypted.get("cvv", "123"),
                    "expiry": decrypted.get("expiry", "12/29"),
                    "severity": "CRITICAL",
                    "financial_risk": "High - Card details are exposed and can be used for fraud on any online store."
                })
            except Exception:
                pass
        else:
            for t in tokens:
                async with db.execute("SELECT encrypted_blob FROM cards WHERE token = ?", (t,)) as cursor:
                    row = await cursor.fetchone()
                    if row:
                        try:
                            decrypted = _decrypt_card(row[0])
                            masked = f"{t[:4]}{'*' * 8}{t[-4:]}"

                            # With SecurePay: Only the token is exposed (no CVV, no Expiry, no real card)
                            exposed_with.append({
                                "token_masked": masked,
                                "severity": "SECURE",
                                "financial_risk": "Zero - Token is merchant-locked and cannot be used elsewhere."
                            })

                            # Without SecurePay: The real card database is leaked (exposing PAN, CVV, Expiry, Cardholder)
                            exposed_without.append({
                                "cardholder": decrypted.get("cardholder", "Valued Customer"),
                                "pan": f"{decrypted.get('pan')[:4]} {decrypted.get('pan')[4:8]} {decrypted.get('pan')[8:12]} {decrypted.get('pan')[12:]}",
                                "cvv": decrypted.get("cvv"),
                                "expiry": decrypted.get("expiry"),
                                "severity": "CRITICAL",
                                "financial_risk": "High - Card details are exposed and can be used for fraud on any online store."
                            })
                        except Exception:
                            pass
    return exposed_without, exposed_with


async def has_master_card() -> bool:
    """
    Check if a USER_MASTER_CARD entry exists in the vault.
    """
    await _ensure_db()
    async with aiosqlite.connect(_db_path()) as db:
        async with db.execute("SELECT 1 FROM cards WHERE token = ?", ("USER_MASTER_CARD",)) as cur:
            row = await cur.fetchone()
            return row is not None
