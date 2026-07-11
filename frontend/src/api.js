import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const generateToken = async (merchant, amount, currency = "PKR", ttlSeconds = 300) => {
  const response = await client.post('/generate-token', {
    merchant,
    amount,
    currency,
    ttl_seconds: ttlSeconds,
  });
  return response.data;
};

export const pay = async (token, merchant, amount, metadata) => {
  const response = await client.post('/pay', {
    token,
    merchant,
    amount,
    metadata,
  });
  return response.data;
};

export const killToken = async (token) => {
  const response = await client.post('/kill-token', { token });
  return response.data;
};

export const getTransactions = async () => {
  const response = await client.get('/transactions');
  return response.data;
};

export const simulateMerchant = async (token, amount, merchantName, metadata = {}) => {
  const response = await client.post('/merchant/simulate', {
    token,
    amount,
    merchant_name: merchantName,
    metadata,
  });
  return response.data;
};

export const getHealth = async () => {
  const response = await client.get('/health');
  return response.data;
};

export const updateTokenStatus = async (token, status) => {
  const response = await client.post('/update-token-status', { token, status });
  return response.data;
};

export const updateTokenLimit = async (token, amount) => {
  const response = await client.post('/update-token-limit', { token, amount });
  return response.data;
};

export const simulateBreach = async (merchant) => {
  const response = await client.post('/simulate-breach', { merchant });
  return response.data;
};

export const agentChat = async (message, transactionId, token) => {
  const response = await client.post('/agent/chat', { message, transaction_id: transactionId, token });
  return response.data;
};

export const confirmPayment = async (transactionId, token, otp) => {
  const response = await client.post('/pay/confirm', { transaction_id: transactionId, token, otp });
  return response.data;
};


export const setupWallet = async (pan, expiry, cvv, cardholder) => {
  const response = await client.post('/api/wallet/setup', {
    pan, expiry, cvv, cardholder
  });
  return response.data;
};

export const getWalletStatus = async () => {
  const response = await client.get('/api/wallet/status');
  return response.data;
};

export const rotateKeys = async () => {
  const response = await client.post('/vault/rotate-keys');
  return response.data;
};

export const getCircuitBreakerTelemetry = async () => {
  const response = await client.get('/telemetry/circuit-breaker');
  return response.data;
};

export const getVaultTelemetry = async () => {
  const response = await client.get('/telemetry/vault');
  return response.data;
};

export const getAuditLedger = async () => {
  const response = await client.get('/telemetry/audit-ledger');
  return response.data;
};

export default client;
