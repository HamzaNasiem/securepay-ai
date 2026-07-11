# SecurePay AI 🛡️

[![AMD Instinct MI300X](https://img.shields.io/badge/GPU-AMD%20Instinct%20MI300X-orange?style=for-the-badge&logo=amd)](https://www.amd.com/en/products/accelerators/instinct/mi300/mi300x.html)
[![ROCm 7.2](https://img.shields.io/badge/Platform-ROCm%207.2-blue?style=for-the-badge&logo=amd)](https://rocm.docs.amd.com/)
[![Docker Multi-Stage](https://img.shields.io/badge/Build-Docker%20Multi--Stage-blue?style=for-the-badge&logo=docker)](https://www.docker.com/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-green?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![GitHub Actions CI](https://img.shields.io/github/actions/workflow/status/HamzaNasiem/securepay-ai/docker-publish.yml?branch=main&style=for-the-badge&logo=github-actions)](https://github.com/HamzaNasiem/securepay-ai/actions)

SecurePay AI is a hardware-accelerated fraud prevention engine and decentralized payment tokenization platform built for the **AMD Developer Hackathon: ACT II (Unicorn Track)**. 

The platform eliminates the risk of credit card leaks in data breaches by issuing single-use, merchant-locked, and amount-capped virtual tokens. Every transaction is evaluated in real-time by an Explainable AI (XAI) security analyst model accelerated by **AMD Instinct™ MI300X GPUs**.

---

## 🚀 Key Value Propositions

*   **🔒 Zero-Leak Vault Architecture (PCI-DSS Ready):** Real Primary Account Numbers (PAN), CVVs, and Expiries are encrypted with AES-256-GCM and stored inside an isolated offline SQLite Vault. They never cross the merchant's network boundaries.
*   **🧠 Explainable AI Risk Engine:** Powered by DeepSeek V4 Pro / Gemma 2 hosted on AMD hardware. Instead of returning opaque risk scores, the engine generates plain-language, audit-ready security explanations detailing the precise risk heuristics that triggered the decision.
*   **💡 Interactive Hackathon Tour Mode:** Built directly into the landing interface. An step-by-step guided tour panel walks judges through the entire token generation, payment simulation, and real-time AI settlement process with single-click actions.
*   **⚡ Real-Time AMD Telemetry Dashboard:** Includes live tracking of GPU processing latency (ms), token lifecycle states, and local currency cost-saving metrics.
*   **🛑 Subscription Kill Switch:** Users can instantly revoke or destroy any merchant token from the Active Subscriptions panel to immediately stop future recurring charges.

---

## 🏗️ System Architecture & Data Flow

SecurePay AI segregates transactional data from the cardholder vault to ensure absolute security:

```
                  ┌────────────────────────────────────────┐
                  │        React Frontend (Port 3000)      │
                  │   - 💡 Interactive Tour Console        │
                  │   - 📊 AMD GPU Telemetry Analytics     │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │       FastAPI Backend (Port 8080)      │
                  │   - Token Orchestrator                 │
                  │   - Risk Decision Engine               │
                  └──────────┬──────────────────┬──────────┘
                             │                  │
                             ▼                  ▼
       ┌───────────────────────────┐      ┌───────────────────────────┐
       │   Encrypted SQLite Vault  │      │   Redis Cache Token Store │
       │     (AES-256-GCM Crypt)   │      │    (Status, Limits, TTL)  │
       └───────────────────────────┘      └───────────────────────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │    Fireworks AI API   │
                                    ├───────────────────────┤
                                    │  AMD Instinct MI300X  │
                                    │     Accelerators      │
                                    └───────────────────────┘
```

*   **Prototyping & Benchmarking:** Evaluated and prototyped locally on **AMD AI Cloud Notebooks** running ROCm 7.2 and vLLM. Refer to our evaluation notebook [`amd_rocm_vllm_evaluation.ipynb`](./amd_rocm_vllm_evaluation.ipynb) for local latency benchmarks.
*   **Production Deployment:** Scaled globally by routing inference calls to AMD Instinct MI300X GPU clusters via Fireworks AI Serverless APIs (configured for near-deterministic results).

---

## 🐳 Quick Start (Running with Docker)

The stack is fully containerized using multi-stage, production-ready Docker builds.

### 1. Configure Environment Variables
Create a `.env` file in the root directory:
```bash
cp .env.example .env
```
Update `.env` with your API keys:
```ini
FIREWORKS_API_KEY=your_fireworks_api_key
FIREWORKS_BASE_URL=https://api.fireworks.ai/inference/v1
FIREWORKS_MODEL=accounts/fireworks/models/deepseek-v4-pro
REDIS_URL=redis://redis:6379
VAULT_ENCRYPTION_KEY=replace_with_exactly_32_characters!!
VAULT_DB_PATH=vault.db
FRONTEND_ORIGIN=http://localhost:3000
```

### 2. Launch the Stack
Select one of the options below to start the services:

#### Option A: Pull Pre-built Registry Images (Fastest ⚡)
Run the application instantly without compiling files locally. The images are pre-compiled and pulled directly from GitHub Container Registry (GHCR):
```bash
docker-compose -f docker-compose.prod.yml up -d
```

#### Option B: Build and Run Locally from Source
Compile the multi-stage Dockerfiles locally:
```bash
docker-compose up --build -d
```

Once started, the services will be live at:
*   **React Frontend:** [http://localhost:3000](http://localhost:3000)
*   **FastAPI Backend:** [http://localhost:8080](http://localhost:8080)
*   **Interactive Swagger API Docs:** [http://localhost:8080/docs](http://localhost:8080/docs)

---

## 🧪 Testing the Guided Playground (Walkthrough)

Open **[http://localhost:3000](http://localhost:3000)** and follow the **Interactive Tour Panel**:

1.  **Select Scenario:** Auto-select the **Netflix** scenario (a low-risk recurring subscription of 1,200 PKR).
2.  **Generate Token:** Issues a 16-digit Luhn-valid card token locked to Netflix and capped at 1,200 PKR.
3.  **Send to Checkout:** Simulates the checkout screen. Observe that the merchant only receives the token—the real card numbers are entirely missing from their request payload!
4.  **Run AI Risk Analysis:** The backend calls DeepSeek V4 (running on AMD Instinct GPUs) to verify metadata (device, location, token age, limits) and outputs the approved transaction response with security reasoning.
5.  **Risk Dashboard & Kill Switch:** Switch to the **Risk Dashboard** tab. Run a mock **Netflix Server Breach**. You will see that the attacker gets $0 value because the token is merchant-locked and expired. Click the **Destroy Token** button and confirm to instantly revoke the subscription!
6.  **Agent Workspace:** Go to the Agent tab to chat with the AI Analyst in English or Urdu/Roman Urdu. You can negotiate override policies or ask why a transaction was flagged!

---

## ⚙️ Explainable AI Risk Heuristics

The DeepSeek V4 fraud model evaluates incoming transactions against the following security matrix:

| Heuristic Rule | Parameter Checked | Risk Action / Penalty |
| :--- | :--- | :--- |
| **Micro-Transaction Exemption** | `amount` < 500 PKR | Capped at 30 Risk Score (Auto-Approve to minimize user friction) |
| **Merchant Category Risk Index** | `merchant_category` (e.g. Crypto) | High Risk base score (+40 Penalty) |
| **Velocity & History** | `past_transactions_with_merchant` | Low history + high value (+30 Penalty), Repeat history (-20 Credit) |
| **Context Mismatch Penalty** | `device_known` AND `location_match` | Both mismatch triggers a massive fraud warning (+60 Penalty) |
| **Token Age Anomaly** | `token_age_seconds` < 2s or > 600s | Potential bot script or session hijack (+25 Penalty) |

---

## 📋 API Reference

### 1. Generate Token
`POST /token/generate`
*   **Input:** `{"merchant": "Netflix", "amount": 1200.0, "currency": "PKR", "ttl_seconds": 300}`
*   **Output:** Generates a Luhn-compliant virtual card token and saves it in Redis and the SQLite vault.

### 2. Simulate Merchant Checkout
`POST /merchant/simulate`
*   **Input:** `{"token": "4539...", "amount": 1200.0, "merchant_name": "Netflix", "metadata": {}}`
*   **Output:** Returns a receipt confirming that no real card data (PAN, CVV, Expiry) was received.

### 3. Settle Transaction
`POST /pay`
*   **Input:** Settles the token, runs the AMD-accelerated AI fraud risk assessment, and returns approval or decline decisions.

### 4. Revoke Token
`POST /kill-token`
*   **Input:** `{"token": "4539..."}`
*   **Output:** Invalidates the token in Redis. Subsequent settlement attempts will be rejected.

### 5. Chat with Agent
`POST /agent/chat`
*   **Input:** `{"token": "4539...", "transaction_id": "txn_...", "message": "update krdo"}`
*   **Output:** Negotiates overrides or limit increases with the AI Security Agent.

---

## 💻 Tech Stack

*   **Frontend:** React (Vite), CSS3, Lucide Icons, Nginx.
*   **Backend:** FastAPI, Python 3.11, Uvicorn, SQLite (Encrypted Vault).
*   **Session Cache:** Redis 7 (Alpine).
*   **CI/CD Pipeline:** GitHub Actions.
*   **AI Infrastructure:** AMD Instinct™ MI300X GPUs via Fireworks AI Cloud / ROCm 7.2 + vLLM.
