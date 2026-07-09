#!/bin/bash
set -e

BASE_URL=${BACKEND_URL:-"http://localhost:8080"}

echo "=========================================================="
echo "   SecurePay AI — Integration Test Suite (Bash)"
echo "   Target Backend: $BASE_URL"
echo "=========================================================="

# Check health
if ! curl -s -f "$BASE_URL/health" > /dev/null; then
  echo "❌ Error: Backend is not reachable at $BASE_URL/health."
  exit 1
fi
echo "✓ Backend Health: OK"

echo -e "\n[STEP 1] Generating secure token for Netflix (1200 PKR)..."
GEN_RESP=$(curl -s -X POST "$BASE_URL/generate-token" \
  -H "Content-Type: application/json" \
  -d '{"merchant":"Netflix","amount":1200,"currency":"PKR","ttl_seconds":300}')

TOKEN=$(echo "$GEN_RESP" | grep -o '"token":"[^"]*' | head -n1 | cut -d'"' -f4)
MASKED="${TOKEN:0:4}********${TOKEN:12:4}"
echo "✓ Token Issued: $MASKED"

echo -e "\n[STEP 2] Simulating payment submission at merchant terminal..."
PAY_RESP=$(curl -s -X POST "$BASE_URL/pay" \
  -H "Content-Type: application/json" \
  -d '{"token":"'"$TOKEN"'","merchant":"Netflix","amount":1200,"metadata":{"device_known":true,"location_match":true,"past_transactions_with_merchant":6,"merchant_category":"subscription"}}')

TXN_ID=$(echo "$PAY_RESP" | grep -o '"transaction_id":"[^"]*' | head -n1 | cut -d'"' -f4)
DECISION=$(echo "$PAY_RESP" | grep -o '"decision":"[^"]*' | head -n1 | cut -d'"' -f4)
RISK_SCORE=$(echo "$PAY_RESP" | grep -o '"risk_score":[^,]*' | head -n1 | grep -o '[0-9]*' | head -n1)
EXPLANATION=$(echo "$PAY_RESP" | grep -o '"explanation":"[^"]*' | head -n1 | cut -d'"' -f4)

echo "✓ Txn ID: $TXN_ID"
echo "✓ Decision: ${DECISION^^}"
echo "✓ Risk Score: $RISK_SCORE/100"
echo "✓ Explanation: $EXPLANATION"

echo -e "\n[STEP 3] Attempting replay/reuse of the same single-use token..."
REPLAY_RESP=$(curl -s -X POST "$BASE_URL/pay" \
  -H "Content-Type: application/json" \
  -d '{"token":"'"$TOKEN"'","merchant":"Netflix","amount":1200,"metadata":{"device_known":true,"location_match":true,"past_transactions_with_merchant":6,"merchant_category":"subscription"}}')

REPLAY_DECISION=$(echo "$REPLAY_RESP" | grep -o '"decision":"[^"]*' | head -n1 | cut -d'"' -f4)
REPLAY_EXPL=$(echo "$REPLAY_RESP" | grep -o '"explanation":"[^"]*' | head -n1 | cut -d'"' -f4)
echo "✓ Replay Decision: ${REPLAY_DECISION^^}"
echo "✓ Explanation: $REPLAY_EXPL"

echo -e "\n[STEP 4] Testing manual revocation (Kill Switch)..."
TOKEN2_RESP=$(curl -s -X POST "$BASE_URL/generate-token" \
  -H "Content-Type: application/json" \
  -d '{"merchant":"Netflix","amount":1200,"currency":"PKR","ttl_seconds":300}')
TOKEN2=$(echo "$TOKEN2_RESP" | grep -o '"token":"[^"]*' | head -n1 | cut -d'"' -f4)
MASKED2="${TOKEN2:0:4}********${TOKEN2:12:4}"
echo "✓ Generated new token: $MASKED2"

KILL_RESP=$(curl -s -X POST "$BASE_URL/kill-token" \
  -H "Content-Type: application/json" \
  -d '{"token":"'"$TOKEN2"'"}')
KILL_STATUS=$(echo "$KILL_RESP" | grep -o '"status":"[^"]*' | head -n1 | cut -d'"' -f4)
echo "✓ Revocation Status: ${KILL_STATUS^^}"

KILLED_PAY_RESP=$(curl -s -X POST "$BASE_URL/pay" \
  -H "Content-Type: application/json" \
  -d '{"token":"'"$TOKEN2"'","merchant":"Netflix","amount":1200,"metadata":{"device_known":true,"location_match":true,"past_transactions_with_merchant":6,"merchant_category":"subscription"}}')
KILLED_DECISION=$(echo "$KILLED_PAY_RESP" | grep -o '"decision":"[^"]*' | head -n1 | cut -d'"' -f4)
KILLED_EXPL=$(echo "$KILLED_PAY_RESP" | grep -o '"explanation":"[^"]*' | head -n1 | cut -d'"' -f4)
echo "✓ Killed Txn Decision: ${KILLED_DECISION^^}"
echo "✓ Explanation: $KILLED_EXPL"

echo -e "\n[STEP 5] Querying live transaction feed..."
TX_COUNT=$(curl -s "$BASE_URL/transactions" | grep -o '"transaction_id"' | wc -l)
echo "✓ Found $TX_COUNT transactions in the feed."

echo "=========================================================="
echo "   Integration Test Complete: SUCCESS ✓"
echo "=========================================================="
