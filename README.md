# 🛡️ SecurePay AI

### **Disposable Payment Card Tokenization + AI-Explained Fraud Prevention**
*Built for the AMD Developer Hackathon: ACT II — Unicorn Track*

SecurePay AI eliminates the single biggest vulnerability in digital payments: the repeated exposure of a customer's real credit card number (PAN) to every merchant, gateway, and intermediary server it touches. 

It replaces sensitive credentials with disposable, single-use, merchant-locked, and amount-capped tokens, and adds an AI explainability layer powered by **DeepSeek V4 Pro** running on **AMD GPU Cloud Infrastructure** via **Fireworks AI**. Instead of a mysterious "declined" screen, SecurePay AI translates security decisions into clear, plain-language explanations.

---

## 🚀 Why SecurePay AI Wins: Value Proposition
1. **Explainable Trust**: Current fraud prevention engines (like Visa VTS, Mastercard MDES, or rule-based firewalls) act as black boxes. SecurePay AI uses a hosted DeepSeek V4 Pro model to describe *exactly why* a transaction was approved, flagged for verification, or blocked.
2. **True Tokenization Security**: Real card details are stored in an AES-256-GCM encrypted database (Vault) and never returned to any API endpoint, merchant simulator, or logger. The merchant only receives a token that cannot be replayed elsewhere.
3. **Optimized for AMD Ecosystem**: Built explicitly to showcase AMD Developer Cloud compute acceleration, using Fireworks AI's AMD-accelerated endpoints with Google's DeepSeek V4 Pro.

---

## 🏗️ System Architecture

```
                               ┌───────────────────────────┐
                               │       React Frontend      │
                               │  Vite Dev Server (5173)   │
                               └─────────────┬─────────────┘
                                             │ HTTP REST
                                             ▼
                               ┌───────────────────────────┐
                               │      FastAPI Backend      │
                               │      Uvicorn (8080)       │
                               └──────┬──────┬──────┬──────┘
                                      │      │      │
             ┌────────────────────────┘      │      └────────────────────────┐
             ▼                               ▼                               ▼
  ┌─────────────────────┐         ┌─────────────────────┐         ┌─────────────────────┐
  │    Token Engine     │         │   Encrypted Vault   │         │    AI Risk Engine   │
  │     (Redis 7)       │         │ (SQLite + AES-256)  │         │  (DeepSeek V4 Pro on AMD)   │
  │ • Luhn-valid proxy  │         │ • Strict security   │         │ • Strict JSON specs │
  │ • Merchant-locked   │         │   invariant: real   │         │ • 3-tier fallback   │
  │ • TTL & Kill Switch │         │   data never leaks  │         │   defensive parsing │
  └─────────────────────┘         └─────────────────────┘         └─────────────────────┘
```

---

## 🛠️ Quick Start & Setup

### 1. Prerequisites
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/) installed.
- A Fireworks AI API Key (obtainable with hackathon credits or code `AMDXBUILDER`).

### 2. Environment Configuration
Create a `.env` file in the root directory (copied from `.env.example`):
```bash
cp .env.example .env
```
Fill in the credentials in `.env`:
```ini
FIREWORKS_API_KEY=fw_your_api_key_here
FIREWORKS_BASE_URL=https://api.fireworks.ai/inference/v1
FIREWORKS_MODEL=accounts/fireworks/models/DeepSeek V4 Pro2-9b-it
REDIS_URL=redis://redis:6379
VAULT_ENCRYPTION_KEY=replace_with_exactly_32_characters!!
VAULT_DB_PATH=vault.db
FRONTEND_ORIGIN=http://localhost:5173
```

### 3. Run Containerized Services
To build and start the database, backend services, and web interface, execute:
```bash
docker-compose up --build
```
Once initialized, the services will be available at:
- **Web App UI (React)**: `http://localhost:5173`
- **Backend API (FastAPI)**: `http://localhost:8080`
- **API Docs (Swagger)**: `http://localhost:8080/docs`

---

## 🧪 Demo & Testing Scripts

### Option A: Automation Test Suite (Scripted)
Verify all API endpoints, token generation, single-use enforcement, and kill switch revocation using the pre-built test suite:

- **On Windows (PowerShell)**:
  ```powershell
  ./test_flow.ps1
  ```
- **On Linux / AMD Developer Cloud (Bash)**:
  ```bash
  chmod +x test_flow.sh
  ./test_flow.sh
  ```

### Option B: Pre-seed Demo Data (Dashboard)
To populate the transaction feed on your dashboard with five varied real-world scenarios (safe, risky, and replay attempts), run the demo seeder:
```bash
# Inside docker or your virtual environment
cd backend
python seed_demo.py
```
After seeding, navigate to the **Risk Dashboard** in the browser to view the live feed.

---

## 📹 Video Demo Storyboard (For Judges)

1. **Step 1: Scenario Selection**
   - In the **Checkout Terminal**, select **Netflix (1,200 PKR)** (desc: *Safe Subscription*).
   - Click **Generate Secure Token**. A payment card appears showing the masked Luhn-valid proxy card number (`4539 **** **** 1234`) with a ticking countdown.
2. **Step 2: Merchant Checkout Simulation**
   - Click **Send Token to Netflix Checkout**. The Merchant Simulator view renders, demonstrating that Netflix received the token but PAN/CVV fields are completely `null`.
3. **Step 3: AI Fraud Analysis**
   - Click **Process Settlement**. The transaction is processed. DeepSeek V4 Pro returns an **Approved** status with a plain-language explanation citing why the transaction is safe.
4. **Step 4: Real-time Replay Protection**
   - Click **Start New Test** and select **CryptoBazaar.io (45,000 PKR)**. Proceed through the payment. It is **Declined** because the AI flag detects an unrecognized device, location mismatch, and anomalous amount.
5. **Step 5: Kill Switch in Action**
   - Generate a new Netflix token.
   - Go to the **Risk Dashboard**, find the active token row, and click **Kill Token**.
   - Attempt to checkout again with this token. The transaction is instantly blocked with a `Decline — This token was manually revoked` explanation.
