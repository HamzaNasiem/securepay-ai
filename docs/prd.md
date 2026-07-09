# SecurePay AI — Product Requirements Document (PRD)
**Version 1.0 | AMD Developer Hackathon: ACT II — Unicorn Track**

---

## 1. Product Vision

SecurePay AI eliminates the single biggest weak point in digital payments: the repeated exposure of a user's real card number to every merchant, gateway, and server it touches. It replaces that exposure with disposable, single-use payment tokens, and adds an AI layer that doesn't just approve or block a transaction — it explains its reasoning in plain language, so trust is built instead of eroded.

**Positioning statement:**
For consumers and small merchants in underserved markets (Pakistan, South Asia) who currently have no access to enterprise-grade card tokenization, SecurePay AI is a self-serve tokenization and AI-explained fraud layer that makes real card numbers disposable — unlike existing enterprise tokenization (Visa VTS, Mastercard MDES) which is bank-only and gives no human-readable reasoning.

## 2. Problem Statement

1. Real card data (PAN, CVV, expiry) is transmitted and sometimes stored by merchants and payment gateways, creating multiple points of failure.
2. Tokenization solves this at the network/bank level already, but is inaccessible to small businesses and individual developers, especially outside India within South Asia.
3. Fraud detection today is a black box — a declined transaction gives the user no explanation, which increases support burden and erodes trust.

## 3. Goals

### Hackathon goals (this submission)
- G1: Demonstrate a working, end-to-end tokenized payment flow (token issuance → merchant → vault resolution).
- G2: Demonstrate a genuine, non-trivial use of an LLM (Gemma via Fireworks AI) that adds real product value — explainable risk scoring — not a bolted-on chatbot.
- G3: Demonstrably use AMD Developer Cloud / ROCm for backend compute, satisfying the "use of AMD platforms" judging criterion.
- G4: Present a credible, differentiated product and market story.

### Non-goals (explicitly out of scope for hackathon)
- Real bank or card network integration
- PCI-DSS certification or real compliance claims
- Production-grade key management / HSM integration (simulate, and say so clearly in the pitch)

## 4. Target Users

| Persona | Need | How SecurePay AI helps |
|---|---|---|
| Small e-commerce merchant (Pakistan) | Accept online payments without building fraud infra | Plug-and-play token API + AI risk scoring |
| Individual consumer | Doesn't want to expose real card to every subscription site | Generates a disposable token per merchant, can kill it anytime |
| Fintech developer | Wants to add "why was this declined" transparency | Consumes AI's plain-language explanation via API |

## 5. Core Features (MVP scope)

| # | Feature | Description | Priority |
|---|---|---|---|
| F1 | Token generation | One-time, merchant-locked, amount-limited, time-expiring token | Must-have |
| F2 | Token validation | Reject reused, expired, wrong-merchant, or over-limit tokens | Must-have |
| F3 | Encrypted vault | AES-256 encrypted mock storage mapping token → fake card | Must-have |
| F4 | AI risk engine | Gemma (via Fireworks AI) scores + explains each transaction in plain language | Must-have |
| F5 | Decision engine | Combines vault validity + AI risk score into approve/step-up/decline | Must-have |
| F6 | Dashboard | Live transaction feed with AI explanations, kill-token button | Must-have |
| F7 | Merchant simulator | Mimics a real merchant receiving only the token | Must-have |
| F8 | Local AMD-hosted helper model (stretch) | A lightweight anomaly/embedding model run directly on ROCm, feeding into the risk engine | Nice-to-have |

## 6. User Flows (high level)

**Flow A — Consumer buys a subscription**
1. User opens app, selects "Pay with SecurePay AI" for Netflix.
2. App requests a token from the Token Engine (merchant=Netflix, amount=1200 PKR, expiry=5 min).
3. Token is shown/sent to the merchant simulator instead of the real card.
4. Merchant sends token + transaction metadata to the backend for settlement.
5. Vault resolves token → fake card (internally only). AI Risk Engine scores the transaction.
6. Decision engine returns approve/decline + explanation.
7. Dashboard updates live with the transaction and its AI explanation.

**Flow B — User revokes a token**
1. User opens dashboard, sees an active token tied to a merchant.
2. Clicks "Kill token."
3. Token Engine immediately invalidates it in Redis — any further use is auto-declined.

## 7. Success Metrics (for the pitch, not real production KPIs)
- Demo completes full flow (token → merchant → AI decision → dashboard) with zero manual intervention.
- AI explanation is coherent and specific to the transaction data (not generic boilerplate) in ≥90% of demo runs.
- Full flow completes in under 3 seconds end to end (excluding LLM cold start).

## 8. Business Model (for pitch slide, not build scope)
1. B2B SaaS — per-token pricing to small merchants/fintechs.
2. Consumer freemium — free basic tokens, paid tier for geo-fencing/spend-limit controls.
3. White-label licensing to local banks wanting a modern tokenization layer without building it in-house.

## 9. Competitive Differentiation

| Existing solution | Limitation | SecurePay AI's edge |
|---|---|---|
| Visa VTS / Mastercard MDES | Bank/enterprise-only, opaque decisioning | Self-serve, explainable |
| Virtual card providers (Privacy.com, Volopay) | Mostly US/India, not Pakistan-focused, no AI explanation | Localized + AI-explained |
| Rule-based fraud engines | Binary approve/decline, no reasoning shown to user | Natural-language reasoning built in |

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Judges see this as "just tokenization" | Lead every explanation with the AI-explainability angle — that is the actual novelty |
| Time runs out before AI integration is polished | Build token/vault flow first (non-AI), so a fallback demo exists even if AI integration slips |
| LLM gives inconsistent/generic explanations | Constrain prompt to strict JSON schema, test with 5–10 varied transaction scenarios before recording demo |

## 11. Out-of-Scope Clarifications for the Pitch
State explicitly in the presentation: "This hackathon build simulates the vault and card issuance; a production version would integrate with a licensed card network or issuing bank rather than generating card-like numbers independently." This preempts the most likely judge question and shows technical maturity.
