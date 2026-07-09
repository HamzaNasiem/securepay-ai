"""
merchant_sim.py — SecurePay AI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Simulates a merchant's payment processor.

The merchant endpoint receives ONLY a payment token — never a real card number,
CVV, or expiry.  This endpoint is the visual proof point for the demo:
a judge reading the response can confirm that no sensitive data is present.

In production: this route would be on the merchant's own server, not the issuer.
For the hackathon demo: it lives in the same backend to keep the stack simple.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/merchant", tags=["Merchant Simulator"])


# ──────────────────────────────────────────────────────────────────────────────
# Request model
# ──────────────────────────────────────────────────────────────────────────────

class MerchantSimRequest(BaseModel):
    token:         str   = Field(..., min_length=16, max_length=16,
                                 description="Disposable payment token received from the user")
    amount:        float = Field(..., gt=0, description="Transaction amount")
    merchant_name: str   = Field(default="Unknown Merchant",
                                 description="The merchant's display name")
    metadata:      dict  = Field(default_factory=dict,
                                 description="Additional transaction context")


# ──────────────────────────────────────────────────────────────────────────────
# Route
# ──────────────────────────────────────────────────────────────────────────────

@router.post(
    "/simulate",
    summary="Merchant receives token only — never real card data",
    response_description="Merchant receipt showing only token details",
)
async def simulate_merchant_checkout(req: MerchantSimRequest):
    """
    Stand-in for a real merchant's checkout backend.

    Demonstrates the core privacy guarantee of SecurePay AI:
    even the merchant that processes the payment never sees the consumer's
    real card number, CVV, or expiry — only the disposable token.

    In a production integration:
    1. The user generates a token via /generate-token.
    2. The user's browser/app sends the token to the merchant's server (this endpoint).
    3. The merchant's server calls the issuer's /pay endpoint for settlement.
    4. The issuer resolves the token internally — real card data never crosses
       the merchant's server boundary.
    """
    masked = f"{req.token[:4]}{'*' * 8}{req.token[-4:]}"

    logger.info(
        "MERCHANT '%s' received payment request — token=%s amount=%.2f — "
        "NO REAL CARD DATA PRESENT",
        req.merchant_name,
        masked,
        req.amount,
    )

    return {
        "merchant_name":          req.merchant_name,
        "received_token":         masked,
        "received_amount":        req.amount,
        "real_card_data_present": False,
        "pan_received":           None,
        "cvv_received":           None,
        "expiry_received":        None,
        "message": (
            f"{req.merchant_name} received a disposable token for "
            f"{req.amount:.0f} PKR. "
            "No real card number, CVV, or expiry was shared with this merchant. "
            "The token will now be submitted to SecurePay AI for settlement and risk scoring."
        ),
        "next_action": "POST /pay",
        "timestamp":   datetime.now(timezone.utc).isoformat(),
        "demo_note": (
            "In a real deployment, this endpoint would be on the merchant's server. "
            "SecurePay AI resolves the token internally — real card data never "
            "crosses the merchant boundary."
        ),
    }
