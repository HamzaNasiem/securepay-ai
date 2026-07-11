# SecurePay AI 🛡️

[![AMD Instinct MI300X](https://img.shields.io/badge/GPU-AMD%20Instinct%20MI300X-orange?style=for-the-badge&logo=amd)](https://www.amd.com/en/products/accelerators/instinct/mi300/mi300x.html)
[![ROCm 7.2](https://img.shields.io/badge/Platform-ROCm%207.2-blue?style=for-the-badge&logo=amd)](https://rocm.docs.amd.com/)
[![Docker Multi-Stage](https://img.shields.io/badge/Build-Docker%20Multi--Stage-blue?style=for-the-badge&logo=docker)](https://www.docker.com/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-green?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)

SecurePay AI is a world-class, hardware-accelerated fraud prevention engine and disposable tokenization platform. Built for the **AMD Developer Hackathon: ACT II (Unicorn Track)**, the platform eliminates credit card leaks by issuing single-use, merchant-locked, and amount-capped virtual tokens, evaluated in real-time by an Explainable AI Agent running on **AMD Instinct MI300X accelerators**.

---

## 🚀 Key Features

*   **🔒 Zero-Leak Tokenization:** Real Primary Account Numbers (PAN) are encrypted and stored in an offline vault. The merchant only receives a disposable, merchant-locked virtual card token.
*   **🧠 Explainable AI Security:** Powered by DeepSeek V4 Pro / Gemma 2 hosted on AMD hardware, the engine analyzes transactions and outputs plain-language security reasoning explaining why a payment was approved, declined, or held for verification.
*   **⚡ Real-Time AMD Telemetry:** Tracks processing latencies, GPU performance metrics, and cost savings directly on the dashboard.
*   **🛑 Single-Click Kill Switch:** Users can instantly revoke or destroy any merchant token from the Active Subscriptions panel to immediately stop future recurring charges.

---

## 🏗️ System Architecture

SecurePay AI is built as a highly optimized containerized microservice architecture:

```
                  ┌────────────────────────────────────────┐
                  │          React Frontend (Vite)         │
                  │              (Port 3000)               │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │            FastAPI Backend             │
                  │              (Port 8080)               │
                  └──────────┬──────────────────┬──────────┘
                             │                  │
                             ▼                  ▼
       ┌───────────────────────────┐      ┌───────────────────────────┐
       │   Encrypted SQLite Vault  │      │     Redis Token Store     │
       │      (AES-256-GCM)        │      │       (Cache/TTL)         │
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

*   **Prototyping Environment:** Prototyped and evaluated locally on **AMD AI Notebooks** (ROCm 7.2 + vLLM). See the prototyping notebook [`amd_rocm_vllm_evaluation.ipynb`](./amd_rocm_vllm_evaluation.ipynb) for detailed setup.
*   **Production Inference:** Scaled through Fireworks AI Serverless API routing to AMD MI300X GPU clusters.
*   **Data Isolation:** Real credit card details are encrypted in the SQLite vault with AES-256-GCM and never leave the local environment.

---

## 🐳 Running with Docker (World-Class Containerization)

The stack is fully containerized using optimized, multi-stage Docker builds to keep image sizes minimal and ensure production-grade security.

### 1. Configure Environment Variables
Create a `.env` file in the root directory:
```bash
cp .env.example .env
```
Update `.env` with your Fireworks API key and configurations:
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
You can start the project in two ways:

#### Option A: Pull Pre-built Registry Images (Fastest ⚡)
Run the application instantly without building files locally. The images are pre-compiled and served directly from GitHub Container Registry (GHCR):
```bash
docker-compose -f docker-compose.prod.yml up -d
```

#### Option B: Build and Run Locally
Build and compile the multi-stage images from scratch:
```bash
docker-compose up --build -d
```

Once started, the services will be live at:
*   **React Frontend:** [http://localhost:3000](http://localhost:3000)
*   **FastAPI Backend:** [http://localhost:8080](http://localhost:8080)
*   **Interactive API Docs:** [http://localhost:8080/docs](http://localhost:8080/docs)

---

## 📦 Manual Registry Publishing (Optional)

If you want to manually build and push images to your own Docker registry (like Docker Hub) instead of using our automated GitHub Actions workflow:

```bash
# 1. Log in to your registry
docker login

# 2. Build and tag optimized backend image
docker build -t your-username/securepay-backend:latest -f Dockerfile.backend .

# 3. Build and tag optimized frontend image (uses Nginx serve-stage)
docker build -t your-username/securepay-frontend:latest -f Dockerfile.frontend .

# 4. Push images to registry
docker push your-username/securepay-backend:latest
docker push your-username/securepay-frontend:latest
```

---

## 🧪 Testing the End-to-End Flow

### Interactive UI Walkthrough
1.  Open **[http://localhost:3000](http://localhost:3000)**.
2.  Click **"Enter Demo — Skip Login"** to bypass auth instantly.
3.  Choose a merchant preset (e.g. **Netflix** for low-risk, or **CryptoBazaar** for high-risk simulation).
4.  Click **"Generate secure token"** to issue a merchant-locked, capped card token.
5.  Click **"Send to checkout"** to view what the merchant receives (note that the real card number is entirely missing!).
6.  Click **"Run AI Risk Analysis on AMD Hardware"** to evaluate the risk score and read the plain-language explanation generated by the AMD MI300X GPU.
7.  Click **"Open Agent Workspace"** to enter the security terminal and interactively query the AI agent.

### Automated API Validation Script
Run the automated flow scripts to test the API endpoints locally:

*   **Linux / macOS:**
    ```bash
    chmod +x test_flow.sh
    ./test_flow.sh
    ```
*   **Windows:**
    ```powershell
    ./test_flow.ps1
    ```

---

## 💻 Technical Stack

*   **Frontend:** React (Vite), Tailwind CSS, Lucide Icons, HTML5, Nginx.
*   **Backend:** FastAPI, Python 3.11, Uvicorn, SQLite (Vault).
*   **Cache & Session State:** Redis 7.
*   **Hardware Acceleration & AI Core:** AMD Instinct MI300X accelerators running ROCm 7.2 (via Fireworks AI).
