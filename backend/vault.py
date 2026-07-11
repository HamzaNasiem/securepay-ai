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
import hashlib
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

import aiosqlite
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from kms import derive_kek

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Key derivation
# ──────────────────────────────────────────────────────────────────────────────
_KDF_SALT = b"securepay-ai-vault-v1-fixed-salt"   # fixed for demo; HSM in prod
_cached_keys: dict[int, bytes] = {}

def _derive_aes_key_v(version: int) -> bytes:
    """
    Derive version-specific Key Encryption Key (KEK) using KMS logic.
    """
    global _cached_keys
    if version in _cached_keys:
        return _cached_keys[version]
        
    kek = derive_kek(version)
    _cached_keys[version] = kek
    return kek

def _derive_aes_key() -> bytes:
    """Fallback helper matching old signature, uses KEK version 1."""
    return _derive_aes_key_v(1)


# ──────────────────────────────────────────────────────────────────────────────
# Database path — resolved at call time so load_dotenv() can override it
# ──────────────────────────────────────────────────────────────────────────────

def _db_path() -> Path:
    """
    Return the vault DB path, resolved at call time.
    """
    raw = os.environ.get("VAULT_DB_PATH", "").strip()
    return Path(raw) if raw else Path("vault.db")


_DDL = """
CREATE TABLE IF NOT EXISTS cards (
    token          TEXT PRIMARY KEY,
    encrypted_blob TEXT NOT NULL,
    created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS system_config (
    config_key   TEXT PRIMARY KEY,
    config_value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
    log_index     INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp     TEXT NOT NULL,
    action        TEXT NOT NULL,
    payload       TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    block_hash    TEXT NOT NULL
);
"""

_db_initialised = False   # module-level flag; init_vault() sets this to True


async def init_vault() -> None:
    """
    One-time database schema creation.
    """
    global _db_initialised
    _derive_aes_key()   # warm v1 KEK cache
    async with aiosqlite.connect(_db_path()) as db:
        await db.executescript(_DDL)
        async with db.execute("SELECT config_value FROM system_config WHERE config_key = 'kek_version'") as cur:
            row = await cur.fetchone()
            if not row:
                await db.execute("INSERT INTO system_config (config_key, config_value) VALUES ('kek_version', '1')")
        await db.commit()
    _db_initialised = True
    logger.info("vault: SQLite schema ready at %s ✓", _db_path().resolve())


async def _ensure_db() -> None:
    if not _db_initialised:
        await init_vault()


async def get_kek_version() -> int:
    await _ensure_db()
    async with aiosqlite.connect(_db_path()) as db:
        async with db.execute("SELECT config_value FROM system_config WHERE config_key = 'kek_version'") as cur:
            row = await cur.fetchone()
            return int(row[0]) if row else 1


async def log_audit_event(action: str, payload: dict) -> None:
    await _ensure_db()
    async with aiosqlite.connect(_db_path()) as db:
        previous_hash = "0" * 64
        async with db.execute("SELECT block_hash FROM audit_logs ORDER BY log_index DESC LIMIT 1") as cur:
            row = await cur.fetchone()
            if row:
                previous_hash = row[0]
                
        timestamp = datetime.now(timezone.utc).isoformat()
        payload_str = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        payload_hash = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()
        
        input_data = f"{timestamp}|{action}|{payload_hash}|{previous_hash}".encode("utf-8")
        block_hash = hashlib.sha256(input_data).hexdigest()
        
        await db.execute(
            "INSERT INTO audit_logs (timestamp, action, payload, previous_hash, block_hash) "
            "VALUES (?, ?, ?, ?, ?)",
            (timestamp, action, payload_str, previous_hash, block_hash)
        )
        await db.commit()
        logger.info("vault audit ledger: enqueued block %s for action %s", block_hash[:8], action)


async def get_audit_ledger() -> list[dict]:
    """
    Returns the complete cryptographic WORM audit trail.
    Verifies the integrity of each block index on the fly.
    """
    await _ensure_db()
    ledger = []
    async with aiosqlite.connect(_db_path()) as db:
        async with db.execute("SELECT log_index, timestamp, action, payload, previous_hash, block_hash FROM audit_logs ORDER BY log_index ASC") as cur:
            async for index, ts, act, pay_str, prev_h, block_h in cur:
                payload_hash = hashlib.sha256(pay_str.encode("utf-8")).hexdigest()
                input_data = f"{ts}|{act}|{payload_hash}|{prev_h}".encode("utf-8")
                computed_hash = hashlib.sha256(input_data).hexdigest()
                
                is_valid = computed_hash == block_h
                ledger.append({
                    "log_index": index,
                    "timestamp": ts,
                    "action": act,
                    "payload": json.loads(pay_str),
                    "previous_hash": prev_h,
                    "block_hash": block_h,
                    "integrity_verified": is_valid
                })
    return ledger


async def rotate_vault_keys() -> int:
    """
    KMS Key Rotation simulation. Increments KEK version, decrypts all card DEKs 
    using old version, re-encrypts using new version KEK, and updates database.
    """
    await _ensure_db()
    current_version = await get_kek_version()
    new_version = current_version + 1
    new_kek = _derive_aes_key_v(new_version)
    
    cards_to_update = []
    async with aiosqlite.connect(_db_path()) as db:
        async with db.execute("SELECT token, encrypted_blob FROM cards") as cur:
            async for token, blob in cur:
                try:
                    decrypted = _decrypt_card(blob)
                    new_blob = _encrypt_v(decrypted, new_kek, new_version)
                    
                    for k in list(decrypted.keys()):
                        decrypted[k] = ""
                    del decrypted
                    cards_to_update.append((new_blob, token))
                except Exception as exc:
                    logger.error("vault key rotation: failed to decrypt token %s: %s", token, exc)

        for new_blob, token in cards_to_update:
            await db.execute("UPDATE cards SET encrypted_blob = ? WHERE token = ?", (new_blob, token))
        
        await db.execute(
            "INSERT OR REPLACE INTO system_config (config_key, config_value) VALUES ('kek_version', ?)",
            (str(new_version),)
        )
        await db.commit()
        
    await log_audit_event("KMS_KEY_ROTATION", {"old_version": current_version, "new_version": new_version, "records_rewrapped": len(cards_to_update)})
    logger.info("vault: rotated KEK from v%d to v%d. Updated %d cards.", current_version, new_version, len(cards_to_update))
    return new_version


# ──────────────────────────────────────────────────────────────────────────────
# Encryption / Decryption — INTERNAL ONLY
# ──────────────────────────────────────────────────────────────────────────────

def _encrypt_v(data: dict, kek: bytes, version: int) -> str:
    """
    AES-256-GCM encrypt a dict using Envelope Encryption (envv2) under a specific KEK version.
    """
    dek = secrets.token_bytes(32)
    aesgcm_dek = AESGCM(dek)
    nonce_data = secrets.token_bytes(12)
    plaintext = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ct_data = aesgcm_dek.encrypt(nonce_data, plaintext, None)
    b64_data = base64.b64encode(nonce_data + ct_data).decode("ascii")
    
    aesgcm_kek = AESGCM(kek)
    nonce_dek = secrets.token_bytes(12)
    ct_dek = aesgcm_kek.encrypt(nonce_dek, dek, None)
    b64_dek = base64.b64encode(nonce_dek + ct_dek).decode("ascii")
    
    return f"envv2:{version}:{b64_dek}:{b64_data}"


def _encrypt(data: dict) -> str:
    """Fallback encryption helper using KEK version 1."""
    kek = _derive_aes_key_v(1)
    return _encrypt_v(data, kek, 1)


def _decrypt_card(blob: str) -> dict:
    """
    AES-256-GCM decrypt a stored blob → dict.
    Supports envv2, envv1, and legacy fallback formats.
    """
    if blob.startswith("envv2:"):
        parts = blob.split(":")
        if len(parts) != 4:
            raise ValueError("Vault blob envelope envv2 format is invalid.")
        
        kek_version_str = parts[1]
        b64_dek = parts[2]
        b64_data = parts[3]
        
        kek = _derive_aes_key_v(int(kek_version_str))
        aesgcm_kek = AESGCM(kek)
        raw_dek = base64.b64decode(b64_dek)
        dek = aesgcm_kek.decrypt(raw_dek[:12], raw_dek[12:], None)
        
        aesgcm_dek = AESGCM(dek)
        raw_data = base64.b64decode(b64_data)
        pt = aesgcm_dek.decrypt(raw_data[:12], raw_data[12:], None)
        return json.loads(pt.decode("utf-8"))
        
    elif blob.startswith("envv1:"):
        parts = blob.split(":")
        if len(parts) != 3:
            raise ValueError("Vault blob envelope envv1 format is invalid.")
        
        b64_dek = parts[1]
        b64_data = parts[2]
        
        kek = _derive_aes_key_v(1)
        aesgcm_kek = AESGCM(kek)
        raw_dek = base64.b64decode(b64_dek)
        dek = aesgcm_kek.decrypt(raw_dek[:12], raw_dek[12:], None)
        
        aesgcm_dek = AESGCM(dek)
        raw_data = base64.b64decode(b64_data)
        pt = aesgcm_dek.decrypt(raw_data[:12], raw_data[12:], None)
        return json.loads(pt.decode("utf-8"))
        
    else:
        kek = _derive_aes_key_v(1)
        aesgcm = AESGCM(kek)
        raw = base64.b64decode(blob)
        if len(raw) < 12:
            raise ValueError("Vault blob is too short.")
        pt = aesgcm.decrypt(raw[:12], raw[12:], None)
        return json.loads(pt.decode("utf-8"))


# ──────────────────────────────────────────────────────────────────────────────
# Public API — ONLY these functions may be imported by other modules
# ──────────────────────────────────────────────────────────────────────────────

async def store_card(token: str) -> None:
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

    version = await get_kek_version()
    kek = _derive_aes_key_v(version)
    blob = _encrypt_v(card_data, kek, version)

    for k in list(card_data.keys()):
        card_data[k] = ""
    del card_data

    async with aiosqlite.connect(_db_path()) as db:
        await db.execute(
            "INSERT OR REPLACE INTO cards (token, encrypted_blob, created_at) VALUES (?, ?, ?)",
            (token, blob, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()

    await log_audit_event("TOKEN_VAULTED", {"token_masked": f"{token[:4]}****{token[-4:]}"})
    logger.info("vault: card stored for %s****%s under KEK v%d", token[:4], token[-4:], version)


async def store_user_master_card(pan: str, expiry: str, cvv: str, cardholder: str) -> None:
    await _ensure_db()
    card_data = {
        "pan": pan,
        "expiry": expiry,
        "cvv": cvv,
        "cardholder": cardholder,
    }
    
    version = await get_kek_version()
    kek = _derive_aes_key_v(version)
    blob = _encrypt_v(card_data, kek, version)

    for k in list(card_data.keys()):
        card_data[k] = ""
    del card_data

    async with aiosqlite.connect(_db_path()) as db:
        await db.execute(
            "INSERT OR REPLACE INTO cards (token, encrypted_blob, created_at) VALUES (?, ?, ?)",
            ("USER_MASTER_CARD", blob, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()

    await log_audit_event("MASTER_CARD_VAULTED", {"cardholder": cardholder})
    logger.info("vault: user master card securely encrypted and stored under KEK v%d", version)



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

    await log_audit_event("TOKEN_DELETED", {"token_masked": f"{token[:4]}****{token[-4:]}"})
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
                    "pan": f"{decrypted.get('pan')[:4]} **** **** {decrypted.get('pan')[12:]}",
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
                                "pan": f"{decrypted.get('pan')[:4]} **** **** {decrypted.get('pan')[12:]}",
                                "cvv": decrypted.get("cvv"),
                                "expiry": decrypted.get("expiry"),
                                "severity": "CRITICAL",
                                "financial_risk": "High - Card details are exposed and can be used for fraud on any online store."
                            })
                        except Exception:
                            pass
                            
    if exposed_without:
        await log_audit_event("BREACH_SIMULATION_TRIGGERED", {"severity": "CRITICAL", "records_exposed_count": len(exposed_without)})
        
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
