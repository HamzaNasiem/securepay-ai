# Setup and Deployment Guide — SecurePay AI

---

## 1. Prerequisites
- Docker + Docker Compose installed locally
- A Fireworks AI API key (provided via AMD AI Developer Program hackathon credits, or via Native.Builder promo code `AMDXBUILDER`)
- Access to an AMD Developer Cloud GPU instance (allocated per registered hackathon team)
- Node.js 18+ (only if running frontend outside Docker for faster iteration)
- Python 3.11+ (only if running backend outside Docker for faster iteration)

## 2. Environment Variables

Create a `.env` file at the project root (copy from `.env.example`):

```
FIREWORKS_API_KEY=your_fireworks_key_here
FIREWORKS_BASE_URL=https://api.fireworks.ai/inference/v1
FIREWORKS_MODEL=accounts/fireworks/models/DeepSeek V4 Pro2-9b-it
REDIS_URL=redis://redis:6379
VAULT_ENCRYPTION_KEY=replace_with_32_byte_key
BACKEND_PORT=8000
FRONTEND_PORT=5173
```

> Note: confirm the exact DeepSeek V4 Pro model identifier available on Fireworks AI for this hackathon in the AMD/Fireworks docs shared on Discord — model slugs can change; do not hardcode without checking the current Fireworks model catalog.

## 3. Local Development (fastest iteration loop)

**Backend**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt --break-system-packages
uvicorn main:app --reload --port 8000
```

**Redis (required by token engine)**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

## 4. Full Containerized Run (required for submission)

```bash
docker-compose up --build
```

This must bring up:
- `backend` service (FastAPI, port 8000)
- `redis` service (port 6379, internal)
- `frontend` service (served on port 5173 or via nginx on port 80)

**Sample `docker-compose.yml` structure:**
```yaml
version: "3.9"
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "8000:8000"
    env_file: .env
    depends_on:
      - redis
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "5173:5173"
    depends_on:
      - backend
```

## 5. Deploying to AMD Developer Cloud

1. Provision your team's allocated GPU pod (via `notebooks.amd.com/hackathon` — requires your team to be registered on lablab.ai first; allow up to 24 hours for resource allocation).
2. SSH into the instance (or use the provided notebook/terminal interface).
3. Clone your GitHub repo onto the instance.
4. Copy your `.env` file onto the instance (never commit it to the public repo).
5. Run `docker-compose up --build -d`.
6. Confirm the backend is reachable: `curl http://localhost:8000/transactions`.
7. If exposing publicly for the demo video/judges, open the required port through the instance's network/firewall settings (check AMD Developer Cloud docs for the current process, as this can change).

## 6. Fireworks AI Integration Check

Quick sanity test before wiring into the app:
```bash
curl https://api.fireworks.ai/inference/v1/chat/completions \
  -H "Authorization: Bearer $FIREWORKS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "'"$FIREWORKS_MODEL"'",
    "messages": [{"role": "user", "content": "Reply with only: {\"status\": \"ok\"}"}]
  }'
```
If this returns a valid JSON-ish response, the key and endpoint are working before you wire it into `ai_risk.py`.

## 7. Optional: Running a Local Helper Model on ROCm

To strengthen the "use of AMD platforms" criterion, run a small local model (e.g. a lightweight anomaly-scoring or embedding model) directly on the AMD GPU via ROCm, instead of relying solely on the Fireworks API call.

```bash
pip install torch --index-url https://download.pytorch.org/whl/rocm6.0 --break-system-packages
python -c "import torch; print(torch.cuda.is_available())"  # should print True on ROCm-enabled instance
```
Use this local model's output (e.g. an anomaly score) as an additional field passed into the DeepSeek V4 Pro prompt in `ai_risk.py`, so the final explanation incorporates a signal computed directly on AMD hardware.

## 8. Pre-Submission Checklist
- [ ] `docker-compose up --build` works from a clean clone with only `.env` added
- [ ] `README.md` includes exact setup steps (copy from this doc)
- [ ] GitHub repo is public
- [ ] `.env` is in `.gitignore` — never commit real keys
- [ ] Demo video recorded showing full flow (token → merchant → AI decision → dashboard)
- [ ] Slides reference the architecture diagram and AMD platform usage explicitly
- [ ] Application URL included in submission if hosted on AMD Developer Cloud

## 9. Common Failure Points to Test Before Recording the Demo
| Symptom | Likely cause | Fix |
|---|---|---|
| Token always "not found" | Redis not reachable from backend container | Check `REDIS_URL` matches the docker-compose service name (`redis`, not `localhost`) |
| Fireworks call times out | Wrong `FIREWORKS_BASE_URL` or expired key | Re-run the curl sanity check in section 6 |
| AI response isn't valid JSON | Model adding prose outside JSON | Tighten system prompt; consider adding `response_format: json_object` if supported by the endpoint |
| Frontend can't reach backend | CORS not enabled on FastAPI | Add `CORSMiddleware` allowing the frontend's origin in `main.py` |
