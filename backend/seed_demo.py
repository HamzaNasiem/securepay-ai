"""
seed_demo.py — SecurePay AI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-seeds the live transaction feed with 5 representative scenarios so the
dashboard is never empty when the demo video recording starts.

Covers:
  ✅ Approve  — Netflix subscription (safe device, known user, low amount)
  🔴 Decline  — International crypto site (unknown device, location mismatch)
  🟡 Step-up  — Spotify (known device but location mismatch, first try)
  ✅ Approve  — Daraz grocery order (trusted context, repeat customer)
  🔴 Decline  — Attempted reuse of an already-used token (single-use enforcement)

Run AFTER the backend is running:
  python seed_demo.py

Or point at a remote backend:
  BACKEND_URL=http://<cloud-ip>:8000 python seed_demo.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from __future__ import annotations

import os
import sys
import time

import httpx

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8080").rstrip("/")

# ──────────────────────────────────────────────────────────────────────────────
# Scenario definitions
# ──────────────────────────────────────────────────────────────────────────────

SCENARIOS = [
    # ── Scenario 1: Safe Netflix subscription ────────────────────────────────
    {
        "label": "✅ Safe — Netflix subscription (expected: APPROVE)",
        "generate": {
            "merchant":    "Netflix",
            "amount":      1200.0,
            "currency":    "PKR",
            "ttl_seconds": 600,
        },
        "pay_metadata": {
            "device_known":                    True,
            "location_match":                  True,
            "past_transactions_with_merchant": 6,
            "merchant_category":               "subscription",
        },
    },
    # ── Scenario 2: Risky international crypto site ───────────────────────────
    {
        "label": "🔴 Risky — Crypto exchange, unknown device (expected: DECLINE)",
        "generate": {
            "merchant":    "CryptoBazaar.io",
            "amount":      45000.0,
            "currency":    "PKR",
            "ttl_seconds": 600,
        },
        "pay_metadata": {
            "device_known":                    False,
            "location_match":                  False,
            "past_transactions_with_merchant": 0,
            "merchant_category":               "crypto_exchange",
        },
    },
    # ── Scenario 3: Step-up — Spotify, location mismatch ─────────────────────
    {
        "label": "🟡 Ambiguous — Spotify, location mismatch (expected: STEP_UP)",
        "generate": {
            "merchant":    "Spotify",
            "amount":      450.0,
            "currency":    "PKR",
            "ttl_seconds": 600,
        },
        "pay_metadata": {
            "device_known":                    True,
            "location_match":                  False,
            "past_transactions_with_merchant": 2,
            "merchant_category":               "subscription",
        },
    },
    # ── Scenario 4: Safe Daraz grocery order ─────────────────────────────────
    {
        "label": "✅ Safe — Daraz grocery, loyal customer (expected: APPROVE)",
        "generate": {
            "merchant":    "Daraz",
            "amount":      3500.0,
            "currency":    "PKR",
            "ttl_seconds": 600,
        },
        "pay_metadata": {
            "device_known":                    True,
            "location_match":                  True,
            "past_transactions_with_merchant": 14,
            "merchant_category":               "ecommerce",
        },
    },
    # ── Scenario 5: Token reuse attempt ──────────────────────────────────────
    # We generate a token, pay it (marking it used), then try to pay again.
    # The second pay call should auto-decline with "token already used".
    {
        "label": "🔴 Token reuse — second payment attempt (expected: DECLINE)",
        "generate": {
            "merchant":    "Netflix",
            "amount":      799.0,
            "currency":    "PKR",
            "ttl_seconds": 600,
        },
        "pay_metadata": {
            "device_known":                    True,
            "location_match":                  True,
            "past_transactions_with_merchant": 3,
            "merchant_category":               "subscription",
        },
        "reuse": True,   # pay once (approved), then pay again (should decline)
    },
]


# ──────────────────────────────────────────────────────────────────────────────
# Runner
# ──────────────────────────────────────────────────────────────────────────────

def separator():
    print("\n" + "─" * 60)


def run_scenario(client: httpx.Client, scenario: dict) -> None:
    separator()
    print(f"  {scenario['label']}")
    separator()

    # Step 1: generate token
    gen_resp = client.post(
        f"{BASE_URL}/generate-token",
        json=scenario["generate"],
    )
    gen_resp.raise_for_status()
    token_data = gen_resp.json()
    token      = token_data["token"]
    masked     = f"{token[:4]}{'*' * 8}{token[-4:]}"

    print(f"  Token:      {masked}")
    print(f"  Merchant:   {token_data['merchant']}")
    print(f"  Amount:     {token_data['amount']} {token_data['currency']}")
    print(f"  Expires at: {token_data['expires_at']}")

    # Step 2: pay
    pay_resp = client.post(
        f"{BASE_URL}/pay",
        json={
            "token":    token,
            "merchant": scenario["generate"]["merchant"],
            "amount":   scenario["generate"]["amount"],
            "metadata": scenario["pay_metadata"],
        },
    )
    if pay_resp.status_code not in (200, 502):
        pay_resp.raise_for_status()
    pay_data = pay_resp.json()

    decision   = pay_data.get("decision", "?").upper()
    risk_score = pay_data.get("risk_score", "N/A")
    explanation = pay_data.get("explanation", "")
    txn_id     = pay_data.get("transaction_id", "?")

    decision_emoji = {"APPROVE": "✅", "STEP_UP": "🟡", "DECLINE": "🔴"}.get(decision, "❓")

    print(f"\n  Transaction: {txn_id}")
    print(f"  Decision:    {decision_emoji} {decision}")
    print(f"  Risk score:  {risk_score}/100")
    print(f"  Explanation: {explanation}")
    print(f"  AI:          {'Available' if pay_data.get('ai_available') else 'FALLBACK'}")

    # Step 3: reuse attempt (for scenario 5)
    if scenario.get("reuse"):
        print(f"\n  ↳ Attempting token reuse (should auto-decline)...")
        reuse_resp = client.post(
            f"{BASE_URL}/pay",
            json={
                "token":    token,
                "merchant": scenario["generate"]["merchant"],
                "amount":   scenario["generate"]["amount"],
                "metadata": scenario["pay_metadata"],
            },
        )
        if reuse_resp.status_code not in (200, 502):
            reuse_resp.raise_for_status()
        reuse_data   = reuse_resp.json()
        reuse_decision = reuse_data.get("decision", "?").upper()
        print(f"     Reuse decision: {'✅' if reuse_decision == 'APPROVE' else '🔴'} {reuse_decision}")
        print(f"     Explanation:    {reuse_data.get('explanation', '')}")


def wait_for_backend(client: httpx.Client, max_retries: int = 10) -> None:
    print(f"Waiting for backend at {BASE_URL}/health ...")
    for attempt in range(1, max_retries + 1):
        try:
            resp = client.get(f"{BASE_URL}/health", timeout=3.0)
            if resp.status_code == 200:
                print(f"Backend ready ✓ ({resp.json().get('status', 'ok')})")
                return
        except httpx.ConnectError:
            pass
        print(f"  [{attempt}/{max_retries}] Not ready, retrying in 2s...")
        time.sleep(2)
    print("ERROR: Backend did not become ready in time. Is it running?")
    sys.exit(1)


def main() -> None:
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    if hasattr(sys.stderr, "reconfigure"):
        try:
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("=" * 60)
    print("  SecurePay AI — Demo Data Seeder")
    print(f"  Target backend: {BASE_URL}")
    print("=" * 60)

    with httpx.Client(timeout=60.0) as client:
        wait_for_backend(client)

        success = 0
        failed  = 0
        for scenario in SCENARIOS:
            try:
                run_scenario(client, scenario)
                success += 1
                time.sleep(0.5)   # small delay so timestamps are distinct in the feed
            except Exception as exc:
                print(f"\n  ❌ FAILED: {exc}")
                failed += 1

    separator()
    print(f"\n  Seeding complete: {success} succeeded, {failed} failed")
    print(f"  Dashboard: open http://localhost:5173 → Dashboard tab")
    print(f"  API feed:  {BASE_URL}/transactions")
    print()


if __name__ == "__main__":
    main()
