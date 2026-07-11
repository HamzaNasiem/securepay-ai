"""
decision.py — SecurePay AI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Combines token validation result + AI risk engine output into the final
transaction decision, following the rules in architecture_blueprint.md §2.6.

Decision rules (authoritative):
  • Token INVALID → decision = decline (always, regardless of AI score)
                    explanation = the specific token failure reason
  • Token VALID   → decision follows AI's recommendation verbatim
                    explanation = AI's plain-language explanation verbatim

Every response includes a human-readable explanation string — a bare score
with no explanation is never returned.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Optional


# ──────────────────────────────────────────────────────────────────────────────
# ID generation
# ──────────────────────────────────────────────────────────────────────────────

def _new_txn_id() -> str:
    """Generate a short, URL-safe transaction ID: txn_<6 hex chars>"""
    return "txn_" + secrets.token_hex(3)   # e.g. txn_8841a2


# ──────────────────────────────────────────────────────────────────────────────
# Token masking
# ──────────────────────────────────────────────────────────────────────────────

def _mask(token: str) -> str:
    """PCI-style masking: keep first 4 and last 4 digits."""
    return f"{token[:4]}{'*' * 8}{token[-4:]}"


# ──────────────────────────────────────────────────────────────────────────────
# Status mapping
# ──────────────────────────────────────────────────────────────────────────────

# Maps internal token status to a user-facing token_status label in the response
_STATUS_LABELS: dict[str, str] = {
    "active":  "active",
    "used":    "used",
    "killed":  "killed",
    "expired": "expired",
    "error":   "error",
}


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def make_decision(
    token_valid:  bool,
    token_status: str,
    token_reason: str,
    ai_result:    dict,
    token:        str,
    merchant:     str,
    amount:       float,
    currency:     str,
    metadata:     dict,
) -> dict:
    """
    Produce the final transaction decision record.

    Parameters
    ----------
    token_valid   : passed all validation checks in token_engine.validate_token()
    token_status  : current token lifecycle status string
    token_reason  : human-readable explanation from token validation
    ai_result     : return value of ai_risk.score_transaction()
    token         : raw 16-digit token (used for masking only — not stored)
    merchant      : merchant name from the /pay request
    amount        : transaction amount
    currency      : currency code (e.g. "PKR")
    metadata      : original PaymentMetadata dict from the request

    Returns
    -------
    dict: complete transaction record ready to be stored and returned via /pay
    """
    txn_id    = ai_result.get("transaction_id") or _new_txn_id()
    timestamp = datetime.now(timezone.utc).isoformat()
    masked    = _mask(token)

    ai_score      = ai_result.get("risk_score")
    ai_decision   = ai_result.get("decision", "step_up")
    ai_explanation = ai_result.get("explanation", "")
    ai_available  = ai_result.get("ai_available", True)
    model_used    = ai_result.get("model", "unknown")

    # ── Rule 1: Invalid token → always decline ───────────────────────────────
    if not token_valid:
        return {
            "transaction_id": txn_id,
            "token_masked":   masked,
            "merchant":       merchant,
            "amount":         amount,
            "currency":       currency,
            "decision":       "decline",
            "risk_score":     ai_score,         # attach AI score if available
            "explanation":    token_reason,      # specific, not generic
            "token_status":   _STATUS_LABELS.get(token_status, token_status),
            "ai_available":   ai_available,
            "model":          model_used,
            "timestamp":      timestamp,
            "metadata":       metadata,
        }

    # ── Rule 2: Valid token → follow AI ──────────────────────────────────────
    # Ensure we never return a bare score with no explanation
    if not ai_explanation.strip():
        ai_explanation = (
            f"Transaction processed for {merchant}. "
            "Risk assessment complete — see risk score for details."
        )

    # On approve: token will be marked 'used' by main.py after this call returns
    # On step_up/decline: token remains 'active' (user may retry with step-up auth)
    final_token_status = "used" if ai_decision == "approve" else _STATUS_LABELS.get(
        token_status, token_status
    )

    return {
        "transaction_id": txn_id,
        "token_masked":   masked,
        "merchant":       merchant,
        "amount":         amount,
        "currency":       currency,
        "decision":       ai_decision,
        "risk_score":     ai_score,
        "explanation":    ai_explanation,
        "token_status":   final_token_status,
        "ai_available":   ai_available,
        "model":          model_used,
        "timestamp":      timestamp,
        "metadata":       metadata,
    }
