"""
token_engine.py — SecurePay AI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generates Luhn-valid 16-digit payment tokens, stores them in Redis with native
TTL for automatic expiry, validates on use (merchant lock + amount cap), and
supports single-use enforcement plus manual kill.

Token lifecycle:
  active ──► used    (successful /pay call)
  active ──► killed  (manual /kill-token)
  active ──► expired (Redis TTL fires — key disappears, treated as expired)

Luhn algorithm (ISO/IEC 7812-1):
  Starting from the second-to-last digit (position 2 from right in full number,
  i.e. the rightmost digit of the partial number), double every second digit
  moving left.  Sum all digits (doubled values > 9 have 9 subtracted).
  Check digit = (10 - sum % 10) % 10.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from __future__ import annotations

import json
import logging
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# BIN prefix — 453948 is in a reserved/test range, structurally Visa-like
# but belonging to no issuing bank.  Makes tokens look like real card numbers
# for demo visual impact without colliding with live payment networks.
# ──────────────────────────────────────────────────────────────────────────────
_TEST_BIN_PREFIX = "453948"
_TOKEN_LENGTH    = 16

# Status constants — single source of truth shared across the codebase
STATUS_ACTIVE  = "active"
STATUS_USED    = "used"
STATUS_KILLED  = "killed"
STATUS_EXPIRED = "expired"   # logical label; Redis TTL handles actual removal
STATUS_PAUSED  = "paused"

# Residual TTL kept on used/killed keys for audit trail queries
_AUDIT_TTL = 120   # seconds


# ──────────────────────────────────────────────────────────────────────────────
# Luhn algorithm — verified against known test numbers
# ──────────────────────────────────────────────────────────────────────────────

def _luhn_checksum(partial: str) -> int:
    """
    Compute the Luhn check digit for `partial` (the card number WITHOUT its
    check digit).

    Per ISO/IEC 7812-1:
      • The check digit occupies the rightmost position of the full number.
      • Starting from the digit immediately left of the check digit (i.e. the
        rightmost digit of `partial`), double every second digit moving left.
      • If doubling gives a value > 9, subtract 9.
      • Sum all digits (doubled and undoubled alike).
      • check_digit = (10 - sum % 10) % 10

    Verified against: 4532015112830366 (Visa test number — check digit 6).
    """
    digits = [int(c) for c in partial]
    total = 0
    double = True          # rightmost digit of partial is at position 2 from
                           # right in full number → it gets doubled
    for d in reversed(digits):
        if double:
            d2 = d * 2
            total += d2 - 9 if d2 > 9 else d2
        else:
            total += d
        double = not double
    return (10 - (total % 10)) % 10


def _luhn_valid(number: str) -> bool:
    """Return True if `number` (complete, including check digit) passes Luhn."""
    return _luhn_checksum(number[:-1]) == int(number[-1])


def _build_token() -> str:
    """
    Generate a cryptographically random, Luhn-valid 16-digit payment token.

    Uses secrets.choice (CSPRNG) for every random digit.
    Raises RuntimeError on the astronomically unlikely event that the Luhn
    self-check fails (replaces the unsafe assert statement).
    """
    fill_len   = _TOKEN_LENGTH - len(_TEST_BIN_PREFIX) - 1   # 1 slot for check digit
    random_mid = "".join(secrets.choice(string.digits) for _ in range(fill_len))
    body       = _TEST_BIN_PREFIX + random_mid
    check      = _luhn_checksum(body)
    token      = body + str(check)

    # Hard self-check — never use assert (disabled by Python -O flag)
    if not _luhn_valid(token):
        raise RuntimeError(
            f"Luhn self-check failed for generated token prefix {token[:6]}... "
            "This is a bug in the Luhn implementation."
        )
    return token


# ──────────────────────────────────────────────────────────────────────────────
# Display helpers
# ──────────────────────────────────────────────────────────────────────────────

def mask_token(token: str) -> str:
    """PCI-style display masking: 4539 → 4539********5678"""
    return f"{token[:4]}{'*' * 8}{token[-4:]}"


# ──────────────────────────────────────────────────────────────────────────────
# Redis key helper
# ──────────────────────────────────────────────────────────────────────────────

def _rkey(token: str) -> str:
    """Namespace the Redis key to avoid collisions with other services."""
    return f"securepay:token:{token}"


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

async def generate_token(
    redis_client: aioredis.Redis,
    merchant:     str,
    amount:       float,
    currency:     str = "PKR",
    ttl_seconds:  int = 300,
) -> dict:
    """
    Issue a new payment token and persist it in Redis with a TTL of ttl_seconds + _AUDIT_TTL.
    The extra audit window allows the token to remain retrievable after it logically expires,
    so we can return a descriptive 'expired' response instead of a generic 'not found' 404.
    """
    token      = _build_token()
    now        = datetime.now(timezone.utc)
    expires_dt = now + timedelta(seconds=ttl_seconds)
    expires_at = expires_dt.isoformat()
    expiry_str = expires_dt.strftime("%m/%y")
    cvv_str    = "".join(secrets.choice(string.digits) for _ in range(3))

    payload = {
        "token":       token,
        "merchant":    merchant,
        "amount":      float(amount),
        "currency":    currency,
        "status":      STATUS_ACTIVE,
        "expires_at":  expires_at,
        "created_at":  now.isoformat(),
        "ttl_seconds": ttl_seconds,
        "token_cvv":   cvv_str,
        "token_expiry": expiry_str,
    }

    # Store with extra audit buffer to support logical expiration response
    await redis_client.setex(
        _rkey(token),
        ttl_seconds + _AUDIT_TTL,
        json.dumps(payload),
    )

    logger.info(
        "Token issued: %s merchant=%s amount=%.2f %s ttl=%ds",
        mask_token(token), merchant, amount, currency, ttl_seconds,
    )

    return {
        "token":         token,           # raw — only returned here
        "token_masked":  mask_token(token),
        "merchant":      merchant,
        "amount":        amount,
        "currency":      currency,
        "expires_at":    expires_at,
        "status":        STATUS_ACTIVE,
        "ttl_seconds":   ttl_seconds,
        "token_cvv":     cvv_str,
        "token_expiry":  expiry_str,
    }


async def validate_token(
    redis_client: aioredis.Redis,
    token:        str,
    merchant:     str,
    amount:       float,
) -> Tuple[bool, str, str]:
    """
    Validate a token for settlement.

    Returns (valid: bool, status: str, human_readable_reason: str).

    Rules checked in order (first failure short-circuits):
      1. Key must exist in Redis (handled by caller checking existence, or here returning expired).
      2. Status must not be 'used' or 'killed'.
      3. Token must not have crossed its logical expires_at timestamp.
      4. Merchant must match (case-insensitive).
      5. Amount must not exceed the token's cap.
    """
    raw = await redis_client.get(_rkey(token))

    if raw is None:
        return (
            False,
            STATUS_EXPIRED,
            "Token not found — it has expired, been used, or never existed.",
        )

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("validate_token: corrupt Redis payload for token %s...", token[:4])
        return (False, "error", "Token data is corrupt — cannot validate.")

    status = data.get("status", STATUS_ACTIVE)

    # Status checks take priority
    if status == STATUS_USED:
        return (
            False,
            STATUS_USED,
            "This token was already used for a payment and cannot be reused.",
        )

    if status == STATUS_KILLED:
        return (
            False,
            STATUS_KILLED,
            "This token was manually revoked and is permanently invalid.",
        )

    if status == STATUS_PAUSED:
        return (
            False,
            STATUS_PAUSED,
            "This token is temporarily paused by the cardholder.",
        )

    # Logical expiration check
    expires_at_str = data.get("expires_at")
    if expires_at_str:
        try:
            expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            if now > expires_at:
                diff = int((now - expires_at).total_seconds())
                # Return logically expired status
                return (
                    False,
                    STATUS_EXPIRED,
                    f"This token expired {diff} seconds ago and cannot be used.",
                )
        except Exception as e:
            logger.warning("validate_token: failed to parse expires_at '%s': %s", expires_at_str, e)

    # Merchant lock (case-insensitive comparison)
    stored_merchant = data.get("merchant", "")
    if stored_merchant.lower() != merchant.lower():
        return (
            False,
            STATUS_ACTIVE,
            (
                f"Token was issued for merchant '{stored_merchant}' "
                f"but presented to '{merchant}' — merchant mismatch."
            ),
        )

    # Amount cap
    token_limit = float(data.get("amount", 0))
    if amount > token_limit + 0.001:   # 0.001 tolerance for float rounding
        return (
            False,
            STATUS_ACTIVE,
            (
                f"Transaction amount {amount:.2f} {data.get('currency', '')} "
                f"exceeds the token limit of {token_limit:.2f} {data.get('currency', '')}."
            ),
        )

    return True, STATUS_ACTIVE, "Token valid."


async def kill_token(
    redis_client: aioredis.Redis,
    token:        str,
) -> dict:
    """
    Immediately invalidate an active token.
    Sets status='killed' in Redis (keeps key alive for audit TTL).
    """
    raw = await redis_client.get(_rkey(token))
    if raw is None:
        return {
            "token":  token,
            "status": STATUS_EXPIRED,
            "note":   "Token not found — already expired or never issued.",
        }

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}

    data["status"] = STATUS_KILLED
    await redis_client.setex(_rkey(token), _AUDIT_TTL, json.dumps(data))

    logger.info("Token killed: %s", mask_token(token))
    return {"token": token, "status": STATUS_KILLED}


async def mark_used(
    redis_client: aioredis.Redis,
    token:        str,
) -> None:
    """
    Mark a token as 'used' after a successful payment.
    Keeps the Redis key alive for the audit TTL.
    """
    raw = await redis_client.get(_rkey(token))
    if raw is None:
        logger.warning("mark_used: token %s... not found in Redis", token[:4])
        return

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}

    data["status"] = STATUS_USED
    await redis_client.setex(_rkey(token), _AUDIT_TTL, json.dumps(data))
    logger.info("Token marked used: %s", mask_token(token))


async def get_token_data(
    redis_client: aioredis.Redis,
    token:        str,
) -> Optional[dict]:
    """
    Return raw token metadata from Redis, or None if not found / corrupt.
    Used by main.py to compute token_age_seconds for the AI payload.
    """
    raw = await redis_client.get(_rkey(token))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def update_token_status(
    redis_client: aioredis.Redis,
    token:        str,
    status:       str,
) -> dict:
    """
    Update the status of an existing token (e.g. paused or active).
    Preserves the remaining TTL of the key in Redis.
    """
    key = _rkey(token)
    raw = await redis_client.get(key)
    if raw is None:
        return {"token": token, "status": STATUS_EXPIRED, "error": "Token not found"}

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}

    data["status"] = status
    ttl = await redis_client.ttl(key)
    if ttl > 0:
        await redis_client.setex(key, ttl, json.dumps(data))
    else:
        await redis_client.set(key, json.dumps(data))

    logger.info("Token status updated: %s -> %s", mask_token(token), status)
    return {"token": token, "status": status}


async def update_token_limit(
    redis_client: aioredis.Redis,
    token:        str,
    limit:        float,
) -> dict:
    """
    Update the spend limit amount of an existing token in Redis.
    Preserves the remaining TTL of the key in Redis.
    """
    key = _rkey(token)
    raw = await redis_client.get(key)
    if raw is None:
        return {"token": token, "amount": 0.0, "error": "Token not found"}

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}

    data["amount"] = float(limit)
    ttl = await redis_client.ttl(key)
    if ttl > 0:
        await redis_client.setex(key, ttl, json.dumps(data))
    else:
        await redis_client.set(key, json.dumps(data))

    logger.info("Token limit updated: %s -> %.2f", mask_token(token), limit)
    return {"token": token, "amount": limit}
