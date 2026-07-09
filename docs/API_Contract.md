# API Contract — SecurePay AI

All endpoints are served by the FastAPI backend. Base URL (local): `http://localhost:8000`

---

## 1. `POST /generate-token`

Generates a one-time, merchant-locked, amount-limited payment token.

**Request body**
```json
{
  "merchant": "Netflix",
  "amount": 1200,
  "currency": "PKR",
  "ttl_seconds": 300
}
```

**Response `200`**
```json
{
  "token": "4539482913571234",
  "merchant": "Netflix",
  "amount": 1200,
  "currency": "PKR",
  "expires_at": "2026-07-09T18:45:00Z",
  "status": "active"
}
```

**Errors**
| Code | Reason |
|---|---|
| 400 | Missing/invalid `merchant` or `amount` |
| 500 | Vault write failure |

---

## 2. `POST /pay`

Simulates a merchant submitting a token for settlement. Triggers vault validation + AI risk scoring + final decision.

**Request body**
```json
{
  "token": "4539482913571234",
  "merchant": "Netflix",
  "amount": 1200,
  "metadata": {
    "device_known": true,
    "location_match": true,
    "past_transactions_with_merchant": 6,
    "merchant_category": "subscription"
  }
}
```

**Response `200`**
```json
{
  "transaction_id": "txn_8841a2",
  "decision": "approve",
  "risk_score": 8,
  "explanation": "This looks safe — the token matches the correct merchant and amount, the device is recognized, and you've paid Netflix six times before.",
  "token_status": "used"
}
```

**Response `200` — declined case**
```json
{
  "transaction_id": "txn_8841b7",
  "decision": "decline",
  "risk_score": 91,
  "explanation": "This was blocked because the token had already expired 40 seconds earlier, and the request came from an unrecognized device.",
  "token_status": "expired"
}
```

**Errors**
| Code | Reason |
|---|---|
| 400 | Malformed request |
| 404 | Token not found |
| 409 | Token already used / expired / merchant mismatch (still returns 200 with `decision: decline` for demo purposes — use 409 only for hard structural errors) |
| 502 | Fireworks AI call failed (fallback: return `risk_score: null`, `decision: step_up`, `explanation: "AI risk engine unavailable — manual review required."`) |

---

## 3. `POST /kill-token`

Immediately invalidates an active token.

**Request body**
```json
{ "token": "4539482913571234" }
```

**Response `200`**
```json
{ "token": "4539482913571234", "status": "killed" }
```

---

## 4. `GET /transactions`

Returns the live transaction feed for the dashboard.

**Response `200`**
```json
{
  "transactions": [
    {
      "transaction_id": "txn_8841a2",
      "token_masked": "4539********1234",
      "merchant": "Netflix",
      "amount": 1200,
      "risk_score": 8,
      "decision": "approve",
      "explanation": "This looks safe — the token matches the correct merchant and amount, the device is recognized, and you've paid Netflix six times before.",
      "timestamp": "2026-07-09T18:40:12Z"
    }
  ]
}
```

---

## 5. Internal contract — AI Risk Engine prompt/response (not externally exposed)

**Prompt input sent to Fireworks AI (Gemma model)**
```json
{
  "amount": 1200,
  "currency": "PKR",
  "merchant": "Netflix",
  "merchant_category": "subscription",
  "token_age_seconds": 12,
  "device_known": true,
  "location_match": true,
  "past_transactions_with_merchant": 6
}
```

**Required model output (strict JSON only, no prose outside JSON)**
```json
{
  "risk_score": 8,
  "decision": "approve",
  "explanation": "One or two plain-language sentences referencing the specific fields above."
}
```

**System prompt constraint (put this in code, not just documentation):**
> "You are a payment risk analyst. You will receive transaction metadata as JSON. Respond with ONLY a JSON object containing risk_score (0-100 integer), decision (one of: approve, step_up, decline), and explanation (1-2 sentences, referencing specific details from the input, plain English, no jargon). Do not include any text outside the JSON object."

---

## 6. Error Response Shape (standard across all endpoints)
```json
{
  "error": true,
  "code": "TOKEN_EXPIRED",
  "message": "This token expired 40 seconds ago and cannot be used."
}
```

## 7. Environment Variables Required by the API layer
```
FIREWORKS_API_KEY=...
FIREWORKS_BASE_URL=https://api.fireworks.ai/inference/v1
REDIS_URL=redis://redis:6379
VAULT_ENCRYPTION_KEY=...   # 32-byte key for AES-256
```
