# Architecture Blueprint — SecurePay AI

---

## 1. System Overview

SecurePay AI has five logical components. Each is a separate concern so the system stays easy to reason about and easy to demo piece by piece if something breaks live.

```
User App  →  Token Engine  →  Merchant Simulator
                  │
                  ▼
        ┌─────────────────────────────┐
        │   Vault & AI Risk Layer      │
        │   (runs on AMD Dev Cloud)    │
        │                              │
        │  Encrypted Vault ←→ AI Risk  │
        │        Engine (DeepSeek V4 Pro via     │
        │        Fireworks + ROCm)     │
        └──────────────┬───────────────┘
                        ▼
              Decision + Dashboard
```

## 2. Components

### 2.1 User App (Frontend — Checkout)
- React SPA. Single "Pay" button that calls `/generate-token`, then simulates sending that token to a merchant.
- Displays the token (masked realistically) so the demo visibly shows "this is not your real card."

### 2.2 Token Engine (Backend service)
- Responsibilities: generate a token, attach rules (TTL, merchant lock, max amount), store in Redis, validate on use, expire/kill on demand.
- Token format: 16-digit number using a public/mock BIN prefix (e.g. a reserved test-BIN range) + random remaining digits + Luhn-valid checksum, so it *looks* like a real card number structurally without colliding with real BIN ranges.
- Storage: Redis, using native key TTL for automatic expiry — this is the "no service without Redis" primitive that keeps token lifecycle logic simple.

### 2.3 Merchant Simulator
- A second small service/route that stands in for "a website you're paying." It receives only the token + amount, never the real card, and forwards to `/pay` for settlement — demonstrating that even the merchant layer never sees sensitive data.

### 2.4 Vault (Encrypted store)
- A local database (SQLite/Postgres) storing fictitious "real card" records, AES-256-GCM encrypted at rest, keyed by token-lookup only — never exposed via any external-facing endpoint.
- The vault's only external contract: given a valid, unexpired token, return whether it resolves successfully. It never returns the real card number to any caller outside the vault module itself.

### 2.5 AI Risk Engine
- Receives transaction metadata (amount, merchant, merchant category, token age, device/location match flags, historical merchant frequency).
- Calls Fireworks AI, model: DeepSeek V4 Pro (per hackathon partner requirement), with a strict JSON-in/JSON-out prompt contract (see `API_Contract.md`).
- Returns: `risk_score` (0–100), `decision` (`approve` / `step_up` / `decline`), `explanation` (1–2 plain-language sentences).
- Stretch goal: run a lightweight local scoring/embedding model directly on the AMD Developer Cloud GPU via ROCm (e.g. a small anomaly-detection model using PyTorch-ROCm) whose output is passed as an additional signal into the DeepSeek V4 Pro prompt — this directly and visibly uses AMD GPU compute, not just an external API call, which strengthens the "use of AMD platforms" score.

### 2.6 Decision Engine
- Combines: (a) vault/token validity check, (b) AI risk engine output.
- Rule: if token invalid/expired/reused → auto-decline regardless of AI score. If token valid → decision follows AI's recommended action, with the AI's explanation attached.

### 2.7 Dashboard
- Live feed (poll or WebSocket) of transactions: token (masked), merchant, amount, risk score, decision, AI explanation.
- "Kill token" button next to any active token — calls token engine to invalidate immediately.

## 3. Data Flow (sequence)

1. `User App → Token Engine`: `POST /generate-token {merchant, amount}` → returns `{token, expires_at}`
2. `User App → Merchant Simulator`: sends `{token, amount}` (simulating checkout)
3. `Merchant Simulator → Backend`: `POST /pay {token, amount, metadata}`
4. `Backend → Redis (Token Engine)`: validate token (exists? unexpired? correct merchant? under limit?)
5. `Backend → Vault`: resolve token → confirm real card mapping exists (internal only, no data leaves this call)
6. `Backend → Fireworks AI (DeepSeek V4 Pro)`: send transaction metadata, receive risk_score + decision + explanation
7. `Backend → Decision Engine`: combine (4) and (6) → final decision
8. `Backend → Dashboard`: push transaction result for live display
9. `Backend → Token Engine`: mark token as used (single-use enforcement) or expire it

## 4. Security Model (as simulated for the demo)

- Real card data exists in exactly one place: the vault's encrypted table. No API response, log line, or dashboard field should ever contain it — enforce this by never even querying that column outside `vault.py`.
- Tokens are single-use: once consumed (or expired, or manually killed), any further `/pay` call with that token is auto-declined.
- Tokens are merchant-locked and amount-capped: a token generated for Netflix at 1200 PKR cannot be replayed against a different merchant or a higher amount.
- Note for the pitch: in a real deployment, tokens would be issued in partnership with a card network (Visa VTS / Mastercard MDES), not generated independently — the hackathon build simulates this contract.

## 5. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Tailwind | Fast to build, clean UI for demo |
| Backend | Python + FastAPI | Async, fast to scaffold, good with AI SDK calls |
| Token store | Redis | Native TTL support fits token expiry perfectly |
| Vault | SQLite (or Postgres) + AES-256 (via `cryptography` lib) | Simple, demonstrates encryption clearly |
| AI inference | Fireworks AI API, DeepSeek V4 Pro model | Required hackathon partner integration |
| Compute | AMD Developer Cloud (ROCm) | Required for "use of AMD platforms" criterion |
| Containerization | Docker + docker-compose | Required by submission rules |

## 6. Repository Structure (recommended)

```
securepay-ai/
├── backend/
│   ├── main.py                 # FastAPI app entrypoint
│   ├── token_engine.py         # token generation, TTL, validation
│   ├── vault.py                # encrypted mock card storage
│   ├── ai_risk.py              # Fireworks AI / DeepSeek V4 Pro integration
│   ├── decision.py             # combines vault + AI output
│   ├── merchant_sim.py         # merchant-side simulated endpoint
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── Checkout.jsx
│   │   ├── Dashboard.jsx
│   │   └── api.js
│   └── package.json
├── docker-compose.yml
├── Dockerfile.backend
├── Dockerfile.frontend
├── .env.example
└── README.md
```

## 7. Deployment Topology (hackathon demo)

- Single AMD Developer Cloud instance running `docker-compose up` (backend + Redis).
- Frontend can be served statically from the same instance or run locally pointed at the deployed backend URL.
- Fireworks AI called over HTTPS from the backend using `FIREWORKS_API_KEY` / `FIREWORKS_BASE_URL` environment variables.

## 8. Why this architecture is judge-friendly
- Each box in the diagram is independently demoable — if the AI call fails live, you can still show the token/vault flow working, and vice versa.
- The "real card never leaves the vault" invariant is simple to state, simple to verify by reading `vault.py`, and simple to visually confirm in the dashboard (real card fields never rendered).
- AMD usage is explicit and locatable in the repo (backend deployment + optional ROCm helper model), not just a label on a slide.
