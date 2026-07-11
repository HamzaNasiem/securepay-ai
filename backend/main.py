"""
main.py — SecurePay AI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FastAPI application entrypoint.

Exposes the four public endpoints from API_Contract.md:
  POST /generate-token  — issue a disposable, merchant-locked payment token
  POST /pay             — settle a token (vault + AI risk + decision)
  POST /kill-token      — immediately revoke an active token
  GET  /transactions    — live feed for the dashboard

Also includes:
  POST /merchant/simulate  — merchant simulator (see merchant_sim.py)
  GET  /health             — liveness probe

Architecture note:
  Real card data exists in exactly one place: vault.py's encrypted SQLite table.
  No API response, log line, or dashboard field in this file contains it.
  The vault is accessed only through resolve_token() which returns bool only.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from __future__ import annotations

import json
import logging
import os
import time
import re
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as aioredis
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from ai_risk import score_transaction, chat_with_agent
from decision import make_decision
from merchant_sim import router as merchant_router
from token_engine import (
    generate_token,
    get_token_data,
    kill_token,
    mark_used,
    validate_token,
    update_token_status,
    update_token_limit,
)
from vault import delete_card, resolve_token, store_card, init_vault, get_decrypted_breach_records

# ── Bootstrap ─────────────────────────────────────────────────────────────────
# Load .env from current directory or parent directory (useful when running locally from backend/)
_local_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
if os.path.exists(_local_env):
    load_dotenv(_local_env)
else:
    load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# In-memory transaction store
# ──────────────────────────────────────────────────────────────────────────────
# A thread-safe deque that automatically evicts the oldest entry beyond maxlen.
# In production this would be a persistent DB (Postgres / TimescaleDB).
# For the hackathon demo: in-memory is sufficient and removes an extra dependency.
_transactions: deque = deque(maxlen=200)

# ──────────────────────────────────────────────────────────────────────────────
# Redis client — shared across requests via app state
# ──────────────────────────────────────────────────────────────────────────────
_redis: Optional[aioredis.Redis] = None


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Start-up: connect to Redis and initialize vault. Shut-down: close connection."""
    global _redis
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    logger.info("Connecting to Redis at %s", redis_url)
    _redis = aioredis.from_url(redis_url, decode_responses=True)
    try:
        await _redis.ping()
        logger.info("Redis connection established ✓")
    except Exception as exc:
        logger.critical("Cannot reach Redis at %s — %s", redis_url, exc)
        raise

    try:
        await init_vault()
    except Exception as exc:
        logger.critical("Failed to initialize vault DB: %s", exc)
        raise

    yield   # ← application runs here

    await _redis.aclose()
    logger.info("Redis connection closed.")


def _get_redis() -> aioredis.Redis:
    if _redis is None:
        raise HTTPException(status_code=503, detail="Redis not available — check REDIS_URL.")
    return _redis


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI app
# ──────────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SecurePay AI",
    description=(
        "**Disposable payment tokenization + AI-explained fraud scoring.**\n\n"
        "Powered by **DeepSeek V4 Pro** via Fireworks AI on **AMD Infrastructure**.\n\n"
        "No real card data ever leaves the vault module.  "
        "Every risk decision includes a plain-language explanation."
    ),
    version="1.0.0",
    lifespan=_lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
_allowed_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:80",
    "http://localhost",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1",
]
frontend_origin = os.environ.get("FRONTEND_ORIGIN", "").strip()
if frontend_origin:
    _allowed_origins.append(frontend_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Sub-routers ───────────────────────────────────────────────────────────────
app.include_router(merchant_router)


# ──────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ──────────────────────────────────────────────────────────────────────────────

class GenerateTokenRequest(BaseModel):
    merchant:    str   = Field(..., min_length=1, max_length=100,
                               examples=["Netflix"])
    amount:      float = Field(..., gt=0, examples=[1200.0])
    currency:    str   = Field(default="PKR", max_length=3, examples=["PKR"])
    ttl_seconds: int   = Field(default=300, ge=30, le=3600,
                               description="Token lifetime in seconds (30–3600)")

    @field_validator("merchant")
    @classmethod
    def merchant_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("merchant cannot be blank")
        return v.strip()


class WalletSetupRequest(BaseModel):
    pan:        str = Field(..., min_length=15, max_length=19, description="16-digit real card number")
    expiry:     str = Field(..., min_length=5, max_length=5, description="MM/YY format")
    cvv:        str = Field(..., min_length=3, max_length=4, description="CVV code")
    cardholder: str = Field(..., min_length=2, max_length=100, description="Name on card")

    @field_validator("pan")
    @classmethod
    def validate_luhn(cls, v: str) -> str:
        digits = [int(d) for d in v.replace(" ", "") if d.isdigit()]
        if not digits or len(digits) < 13:
            raise ValueError("PAN must be a valid credit card length")
        checksum = 0
        reverse_digits = digits[::-1]
        for i, digit in enumerate(reverse_digits):
            if i % 2 == 1:
                double_digit = digit * 2
                if double_digit > 9:
                    double_digit -= 9
                checksum += double_digit
            else:
                checksum += digit
        if checksum % 10 != 0:
            raise ValueError("PAN failed checksum validation (Luhn algorithm)")
        return v

    @field_validator("expiry")
    @classmethod
    def validate_expiry(cls, v: str) -> str:
        if not re.match(r"^(0[1-9]|1[0-2])\/\d{2}$", v):
            raise ValueError("Expiry must be in MM/YY format")
        return v


class PaymentMetadata(BaseModel):
    device_known:                    bool = Field(default=False)
    location_match:                  bool = Field(default=False)
    past_transactions_with_merchant: int  = Field(default=0, ge=0)
    merchant_category:               str  = Field(default="general")


class PayRequest(BaseModel):
    token:    str             = Field(..., min_length=16, max_length=16,
                                     description="16-digit payment token")
    merchant: str             = Field(..., min_length=1)
    amount:   float           = Field(..., gt=0)
    metadata: PaymentMetadata = Field(default_factory=PaymentMetadata)


class KillTokenRequest(BaseModel):
    token: str = Field(..., min_length=16, max_length=16)


class UpdateTokenStatusRequest(BaseModel):
    token: str = Field(..., min_length=16, max_length=16)
    status: str = Field(..., pattern="^(active|paused)$")


class UpdateTokenLimitRequest(BaseModel):
    token: str = Field(..., min_length=16, max_length=16)
    amount: float = Field(..., gt=0)


class SimulateBreachRequest(BaseModel):
    merchant: str = Field(..., min_length=1)


class AgentChatRequest(BaseModel):
    message:        str = Field(..., min_length=1)
    transaction_id: str = Field(..., min_length=1)
    token:          str = Field(..., min_length=16, max_length=16)


# ──────────────────────────────────────────────────────────────────────────────
# Global exception handler — standardised error shape (API_Contract.md §6)
# ──────────────────────────────────────────────────────────────────────────────

from fastapi.exceptions import RequestValidationError

# ──────────────────────────────────────────────────────────────────────────────
# Global exception handlers — standardised error shape (API_Contract.md §6)
# ──────────────────────────────────────────────────────────────────────────────

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error":   True,
            "code":    _status_to_code(exc.status_code),
            "message": exc.detail,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    message = "Request validation failed"
    if errors:
        loc = " -> ".join(str(x) for x in errors[0].get("loc", []))
        msg = errors[0].get("msg", "invalid value")
        message = f"Invalid field '{loc}': {msg}"
    return JSONResponse(
        status_code=400,
        content={
            "error":   True,
            "code":    "BAD_REQUEST",
            "message": message,
        },
    )


def _status_to_code(status: int) -> str:
    return {
        400: "BAD_REQUEST",
        404: "NOT_FOUND",
        409: "CONFLICT",
        500: "INTERNAL_ERROR",
        502: "AI_UNAVAILABLE",
        503: "SERVICE_UNAVAILABLE",
    }.get(status, "ERROR")


# ──────────────────────────────────────────────────────────────────────────────
# Helper: compute token age
# ──────────────────────────────────────────────────────────────────────────────

def _compute_token_age(token_meta: dict) -> int:
    """Return seconds since the token was created. Returns 0 on any error."""
    created_str = token_meta.get("created_at", "")
    if not created_str:
        return 0
    try:
        created = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
        now     = datetime.now(timezone.utc)
        return max(0, int((now - created).total_seconds()))
    except Exception:
        return 0


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/api/wallet/setup", tags=["Wallet"], summary="Securely vault a real credit card")
async def api_setup_wallet(req: WalletSetupRequest):
    """
    Takes a user's real credit card and encrypts it using AES-256-GCM.
    The real PAN is never returned.
    """
    try:
        from vault import store_user_master_card
        await store_user_master_card(
            pan=req.pan,
            expiry=req.expiry,
            cvv=req.cvv,
            cardholder=req.cardholder
        )
        return {"status": "ok", "message": "Card successfully encrypted and vaulted."}
    except Exception as exc:
        logger.exception("Failed to vault card: %s", exc)
        raise HTTPException(status_code=500, detail="Vault storage error")

@app.get("/api/wallet/status", tags=["Wallet"], summary="Check if a real card is vaulted")
async def api_get_wallet_status():
    try:
        from vault import has_master_card
        exists = await has_master_card()
        return {"has_master_card": exists}
    except Exception as exc:
        logger.exception("Failed to query wallet status: %s", exc)
        raise HTTPException(status_code=500, detail="Vault check error")

@app.post(
    "/generate-token",
    summary="Generate a disposable, merchant-locked payment token",
    tags=["Token Engine"],
)
async def api_generate_token(req: GenerateTokenRequest):
    """
    Issues a one-time payment token.

    The token is:
    - **Luhn-valid** 16-digit number (BIN prefix 453948)
    - **Merchant-locked**: only accepted at the specified merchant
    - **Amount-capped**: cannot be used for more than the specified amount
    - **Time-expiring**: TTL controlled by `ttl_seconds` (default 5 minutes)

    A corresponding AES-256-GCM encrypted vault entry is created simultaneously.
    """
    redis = _get_redis()

    try:
        token_data = await generate_token(
            redis_client=redis,
            merchant=req.merchant,
            amount=req.amount,
            currency=req.currency,
            ttl_seconds=req.ttl_seconds,
        )
    except Exception as exc:
        logger.exception("generate_token failed: %s", exc)
        raise HTTPException(status_code=503, detail="Secure token store unreachable.")

    try:
        await store_card(token_data["token"])
    except Exception as exc:
        logger.exception("vault store_card failed: %s", exc)
        raise HTTPException(status_code=500, detail="Vault write failure.")

    logger.info(
        "Token issued: %s for merchant=%s amount=%s %s ttl=%ss",
        token_data["token_masked"],
        req.merchant,
        req.amount,
        req.currency,
        req.ttl_seconds,
    )
    
    # Return exactly the keys defined in the API Contract response schema
    return {
        "token":        token_data["token"],
        "merchant":     token_data["merchant"],
        "amount":       token_data["amount"],
        "currency":     token_data["currency"],
        "expires_at":   token_data["expires_at"],
        "status":       token_data["status"],
        "token_cvv":    token_data["token_cvv"],
        "token_expiry": token_data["token_expiry"]
    }


@app.post(
    "/pay",
    summary="Submit a token for settlement — triggers AI risk scoring",
    tags=["Payment"],
)
async def api_pay(req: PayRequest):
    """
    Full payment flow:

    1. **Token existence check** — returns 404 if the token does not exist in store.
    2. **Token validation** — checks Redis rules: active? correct merchant? under limit?
    3. **Vault resolution** — confirms encrypted card entry exists (bool only; card data never returned)
    4. **AI risk scoring** — sends metadata to Fireworks AI (DeepSeek V4 Pro on AMD)
    5. **Decision engine** — combines token validity + AI score → final verdict
    6. **Token lifecycle** — marks token as 'used' on approval
    7. **Dashboard feed** — appends transaction to the live feed
    """
    redis = _get_redis()

    # ── Step 0: Check if token exists in Redis ────────────────────────────────
    try:
        token_meta = await get_token_data(redis, req.token)
    except Exception as exc:
        logger.exception("get_token_data failed: %s", exc)
        raise HTTPException(status_code=503, detail="Secure token store unreachable.")

    if not token_meta:
        raise HTTPException(status_code=404, detail="Token not found")

    # ── Step 1: Token validation ─────────────────────────────────────────────
    try:
        valid, token_status, token_reason = await validate_token(
            redis_client=redis,
            token=req.token,
            merchant=req.merchant,
            amount=req.amount,
        )
    except Exception as exc:
        logger.exception("validate_token failed: %s", exc)
        raise HTTPException(status_code=503, detail="Secure token store unreachable.")

    # ── Step 2: Vault resolution (bool only) ─────────────────────────────────
    try:
        vault_ok = await resolve_token(req.token)
    except Exception as exc:
        logger.exception("resolve_token failed: %s", exc)
        raise HTTPException(status_code=500, detail="Vault resolution failure.")

    if valid and not vault_ok:
        valid        = False
        token_status = "error"
        token_reason = (
            "Token exists in session store but no vault entry found. "
            "This token cannot be settled."
        )

    # ── Step 3: AI risk scoring ───────────────────────────────────────────────
    token_age = _compute_token_age(token_meta)

    ai_payload = {
        "amount":                          req.amount,
        "currency":                        "PKR",
        "merchant":                        req.merchant,
        "merchant_category":               req.metadata.merchant_category,
        "token_age_seconds":               token_age,
        "device_known":                    req.metadata.device_known,
        "location_match":                  req.metadata.location_match,
        "past_transactions_with_merchant": req.metadata.past_transactions_with_merchant,
    }

    start_time = time.perf_counter()
    ai_result = await score_transaction(ai_payload)
    latency_ms = int((time.perf_counter() - start_time) * 1000)

    # ── Step 4: Decision engine ───────────────────────────────────────────────
    result = make_decision(
        token_valid=valid,
        token_status=token_status,
        token_reason=token_reason,
        ai_result=ai_result,
        token=req.token,
        merchant=req.merchant,
        amount=req.amount,
        currency="PKR",
        metadata=req.metadata.model_dump(),
    )
    result["latency_ms"] = latency_ms
    result["prompt_tokens"] = ai_result.get("prompt_tokens", 0)
    result["completion_tokens"] = ai_result.get("completion_tokens", 0)

    # ── Step 5: Mark token used on approval ───────────────────────────────────
    if valid and result["decision"] == "approve":
        try:
            await mark_used(redis_client=redis, token=req.token)
        except Exception as exc:
            logger.exception("mark_used failed: %s", exc)
            raise HTTPException(status_code=503, detail="Failed to update token state.")
        result["token_status"] = "used"

    # ── Step 6: Append to live transaction feed ───────────────────────────────
    _transactions.appendleft(result)

    logger.info(
        "Transaction %s: merchant=%s amount=%s decision=%s risk=%s latency=%dms",
        result["transaction_id"],
        req.merchant,
        req.amount,
        result["decision"],
        result["risk_score"],
        latency_ms,
    )

    # Format the exact return dictionary specified in the API Contract for /pay
    pay_response = {
        "transaction_id":    result["transaction_id"],
        "decision":          result["decision"],
        "risk_score":        result["risk_score"],
        "explanation":       result["explanation"],
        "token_status":      result["token_status"],
        "latency_ms":        result["latency_ms"],
        "prompt_tokens":     result["prompt_tokens"],
        "completion_tokens": result["completion_tokens"],
    }

    # If Fireworks AI call failed (ai_available is False), return HTTP 502 with fallback payload
    if not ai_result.get("ai_available", True):
        return JSONResponse(status_code=502, content=pay_response)

    return pay_response


@app.post(
    "/kill-token",
    summary="Immediately revoke an active token",
    tags=["Token Engine"],
)
async def api_kill_token(req: KillTokenRequest):
    """
    Manually invalidate a token.

    After killing:
    - Redis entry is updated to `status: killed` (kept for audit TTL)
    - Vault entry is deleted
    - Any subsequent `/pay` call with this token returns `decision: decline`
      with explanation `"This token was manually revoked."`
    """
    redis  = _get_redis()

    # ── Step 0: Check if token exists in Redis ────────────────────────────────
    try:
        token_meta = await get_token_data(redis, req.token)
    except Exception as exc:
        logger.exception("get_token_data failed: %s", exc)
        raise HTTPException(status_code=503, detail="Secure token store unreachable.")

    if not token_meta:
        # Token has already expired from Redis. Clean up vault entry and return success.
        try:
            await delete_card(req.token)
        except Exception:
            pass
        return {
            "token": req.token,
            "status": "killed"
        }

    try:
        result = await kill_token(redis_client=redis, token=req.token)
    except Exception as exc:
        logger.exception("kill_token failed: %s", exc)
        raise HTTPException(status_code=503, detail="Secure token store unreachable.")

    try:
        # Remove vault entry
        await delete_card(req.token)
    except Exception as exc:
        logger.exception("vault delete_card failed: %s", exc)
        raise HTTPException(status_code=500, detail="Vault operation failed.")

    # Update matching entry in the live feed (optimistic UI update)
    masked = f"{req.token[:4]}{'*' * 8}{req.token[-4:]}"
    for tx in _transactions:
        if tx.get("token_masked") == masked and tx.get("token_status") in ("active", "paused", "used"):
            tx["token_status"] = "killed"

    logger.info("Token killed: %s", masked)
    
    # Return exactly the keys defined in the API Contract response schema
    return {
        "token":  result["token"],
        "status": result["status"]
    }


@app.post(
    "/update-token-status",
    summary="Update the status of a token (e.g. pause or resume)",
    tags=["Token Engine"],
)
async def api_update_token_status(req: UpdateTokenStatusRequest):
    redis = _get_redis()
    try:
        result = await update_token_status(redis_client=redis, token=req.token, status=req.status)
    except Exception as exc:
        logger.exception("update_token_status failed: %s", exc)
        raise HTTPException(status_code=503, detail="Secure token store unreachable.")

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    # Update matching entry in the live feed optimistically
    masked = f"{req.token[:4]}{'*' * 8}{req.token[-4:]}"
    for tx in _transactions:
        if tx.get("token_masked") == masked and tx.get("token_status") in ("active", "paused"):
            tx["token_status"] = req.status

    return {
        "token": result["token"],
        "status": result["status"],
        "message": "Token status updated successfully."
    }


@app.post(
    "/update-token-limit",
    summary="Adjust the spend limit cap of an active token",
    tags=["Token Engine"],
)
async def api_update_token_limit(req: UpdateTokenLimitRequest):
    redis = _get_redis()
    try:
        result = await update_token_limit(redis_client=redis, token=req.token, limit=req.amount)
    except Exception as exc:
        logger.exception("update_token_limit failed: %s", exc)
        raise HTTPException(status_code=503, detail="Secure token store unreachable.")

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    # Update matching entry in the live feed optimistically
    masked = f"{req.token[:4]}{'*' * 8}{req.token[-4:]}"
    for tx in _transactions:
        if tx.get("token_masked") == masked:
            tx["amount"] = req.amount

    return {
        "token": result["token"],
        "amount": result["amount"],
        "message": "Token amount limit updated successfully."
    }


@app.post(
    "/simulate-breach",
    summary="Simulate a database breach for a merchant, showing SecurePay contrast",
    tags=["Merchant Simulator"],
)
async def api_simulate_breach(req: SimulateBreachRequest):
    redis = _get_redis()
    
    # 1. Scan Redis keys matching securepay:token:* to identify tokens issued for this merchant
    try:
        keys = await redis.keys("securepay:token:*")
    except Exception as exc:
        logger.exception("Redis keys scan failed: %s", exc)
        raise HTTPException(status_code=503, detail="Secure token store unreachable.")

    matching_tokens = []
    for k in keys:
        try:
            raw = await redis.get(k)
            if raw:
                data = json.loads(raw)
                if data.get("merchant", "").lower() == req.merchant.lower():
                    matching_tokens.append(data.get("token"))
        except Exception:
            pass

    # 2. Request internal vault to compile decrypted comparison details
    try:
        exposed_without, exposed_with = await get_decrypted_breach_records(matching_tokens)
    except Exception as exc:
        logger.exception("get_decrypted_breach_records failed: %s", exc)
        raise HTTPException(status_code=500, detail="Vault decryption simulation failed.")

    return {
        "merchant": req.merchant,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "exposed_records_without_securepay": exposed_without,
        "exposed_records_with_securepay": exposed_with
    }


@app.post(
    "/agent/chat",
    summary="Interactive chat terminal with the AI Security Analyst Agent",
    tags=["AI Agent"],
)
async def api_agent_chat(req: AgentChatRequest):
    redis = _get_redis()
    
    # 1. Fetch matching transaction to provide context to the agent
    txn = None
    for tx in _transactions:
        if tx.get("transaction_id") == req.transaction_id:
            txn = tx
            break
            
    if not txn:
        # Fallback context if transaction was evicted or not yet in memory
        txn = {
            "transaction_id": req.transaction_id,
            "merchant": "Unknown Merchant",
            "amount": 0.0,
            "decision": "step_up",
            "explanation": "No active transaction log found."
        }

    # 2. Run agent reasoning loop
    try:
        result = await chat_with_agent(req.message, txn)
    except Exception as exc:
        logger.exception("chat_with_agent failed: %s", exc)
        raise HTTPException(status_code=500, detail="AI Agent error.")

    # 3. Execute actions determined by the agent
    action = result.get("action")
    if action == "resume_token":
        # Resume the token state in Redis
        try:
            await update_token_status(redis_client=redis, token=req.token, status="active")
        except Exception as exc:
            logger.exception("Agent resume token action failed: %s", exc)
            raise HTTPException(status_code=503, detail="Failed to execute agent resume action.")
            
        # Update transaction feed status
        masked = f"{req.token[:4]}{'*' * 8}{req.token[-4:]}"
        for tx in _transactions:
            if tx.get("token_masked") == masked:
                tx["token_status"] = "active"
                tx["decision"] = "approve"
                tx["explanation"] = "Resumed and authorized by AI Security Analyst override."

    elif action == "increase_limit":
        # Raise limit dynamically in Redis
        try:
            current_meta = await get_token_data(redis, req.token)
            new_amount = float((current_meta.get("amount") if current_meta else 0.0) + 20000.0)
            await update_token_limit(redis_client=redis, token=req.token, limit=new_amount)
        except Exception as exc:
            logger.exception("Agent increase limit action failed: %s", exc)
            raise HTTPException(status_code=503, detail="Failed to execute agent limit adjustment.")

        # Update transaction feed limit
        masked = f"{req.token[:4]}{'*' * 8}{req.token[-4:]}"
        for tx in _transactions:
            if tx.get("token_masked") == masked:
                tx["amount"] = new_amount
                tx["decision"] = "approve"
                tx["explanation"] = "Limit adjusted upwards by AI Security Analyst override."

    return result


@app.get(
    "/transactions",
    summary="Live transaction feed for the dashboard",
    tags=["Dashboard"],
)
async def api_transactions():
    """
    Returns all transactions in the live feed, newest first.
    The dashboard polls this endpoint every 2.5 seconds.

    Note: the `token_masked` field shows `4539 **** **** 1234` style masking.
    No real card data (PAN, CVV, expiry) is present in any transaction record.
    """
    return {"transactions": list(_transactions)}


@app.get(
    "/health",
    summary="Liveness probe",
    tags=["Infrastructure"],
)
async def health():
    """Quick health check — returns 200 if the service is up."""
    redis_ok = False
    try:
        if _redis:
            await _redis.ping()
            redis_ok = True
    except Exception:
        pass

    return {
        "status":      "ok",
        "service":     "SecurePay AI Backend",
        "version":     "1.0.0",
        "redis":       "connected" if redis_ok else "disconnected",
        "powered_by":  "DeepSeek V4 Pro · Fireworks AI · AMD Infrastructure",
        "vault":       "AES-256-GCM encrypted SQLite",
        "description": (
            "Disposable payment tokenization + AI-explained fraud scoring. "
            "Built for AMD Developer Hackathon ACT II — Unicorn Track."
        ),
    }
