import React, { useState, useEffect } from 'react';
import { getTransactions, killToken, simulateBreach, generateToken, pay, rotateKeys, getCircuitBreakerTelemetry, getVaultTelemetry, getAuditLedger } from './api';

function RiskBar({ score }) {
  if (score === null || score === undefined) return (
    <div className="flex items-center gap-2">
      <div className="progress-bar flex-1">
        <div className="h-full w-0 bg-ink-5 rounded-pill" />
      </div>
      <span className="text-2xs font-mono text-ink-4 w-8 text-right">N/A</span>
    </div>
  );
  return (
    <div className="flex items-center gap-2">
      <div className="progress-bar flex-1">
        <div
          className={`h-full rounded-pill transition-all ${
            score < 30 ? 'bg-ok' : score < 70 ? 'bg-warn' : 'bg-bad'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`text-2xs font-mono font-medium w-8 text-right ${
        score < 30 ? 'text-ok' : score < 70 ? 'text-warn' : 'text-bad'
      }`}>{score}</span>
    </div>
  );
}

function DecisionBadge({ decision }) {
  const map = {
    approve: { cls: 'badge-ok', label: 'Approved' },
    step_up: { cls: 'badge-warn', label: 'Verify' },
    decline: { cls: 'badge-bad', label: 'Declined' },
  };
  const { cls, label } = map[decision] || { cls: 'badge-neutral', label: decision };
  return <span className={cls}>{label}</span>;
}

function LatencySparkline({ latencies }) {
  if (latencies.length < 2) return null;
  const max = Math.max(...latencies, 200);
  const min = Math.min(...latencies, 50);
  const range = max - min || 1;
  const height = 24;
  const width = 80;
  const points = latencies.map((val, idx) => {
    const x = (idx / (latencies.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  
  return (
    <div className="flex items-center gap-1.5 shrink-0 bg-surface border border-border rounded px-2 py-1 shadow-sm">
      <svg className="w-[80px] h-[24px]" viewBox={`0 0 ${width} ${height}`}>
        <polyline
          fill="none"
          stroke="#c15f3c"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    </div>
  );
}

export default function Dashboard({ refreshTrigger }) {
  const [txns, setTxns] = useState([]);
  const [ledgerEvents, setLedgerEvents] = useState([]);
  const [cbTelemetry, setCbTelemetry] = useState(null);
  const [vaultTelemetry, setVaultTelemetry] = useState(null);
  const [rotateLoading, setRotateLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [killing, setKilling] = useState({});

  const [breachMerchant, setBreachMerchant] = useState('Netflix');
  const [breachData, setBreachData] = useState(null);
  const [breachLoading, setBreachLoading] = useState(false);
  const [showBreachModal, setShowBreachModal] = useState(false);
  const [breachConsoleLogs, setBreachConsoleLogs] = useState([]);

  const [isSimulating, setIsSimulating] = useState(false);
  const [simLogText, setSimLogText] = useState('');

  const getSimulatedMerchants = () => {
    const presets = ['Netflix', 'Spotify', 'Daraz', 'CryptoBazaar.io', 'Amazon AWS', 'Uber'];
    const dynamicNames = txns ? txns.map(tx => tx.merchant).filter(Boolean) : [];
    const allMerchants = new Set([...presets]);
    dynamicNames.forEach(name => {
      const exists = [...allMerchants].some(p => p.toLowerCase() === name.toLowerCase());
      if (!exists && name.toLowerCase() !== 'custom merchant' && name.trim()) {
        allMerchants.add(name);
      }
    });
    return [...allMerchants];
  };

  const getRawToken = (tokenMasked) => {
    if (!tokenMasked) return null;
    let raw = localStorage.getItem(`raw_${tokenMasked}`);
    if (raw) return raw;
    const spaced = `${tokenMasked.slice(0, 4)} **** **** ${tokenMasked.slice(12)}`;
    return localStorage.getItem(`raw_${spaced}`);
  };

  const fetch = async (showLoad = false) => {
    if (showLoad) setLoading(true);
    try {
      const data = await getTransactions();
      setTxns(data.transactions || []);
      
      const cbData = await getCircuitBreakerTelemetry();
      setCbTelemetry(cbData);
      
      const vaultData = await getVaultTelemetry();
      setVaultTelemetry(vaultData);
      
      const ledgerData = await getAuditLedger();
      setLedgerEvents(ledgerData.ledger || []);
    } catch { /* silent */ }
    finally { if (showLoad) setLoading(false); }
  };

  const handleRotateKeys = async () => {
    setRotateLoading(true);
    try {
      const res = await rotateKeys();
      setVaultTelemetry(prev => ({ ...prev, kek_version: res.kek_version }));
      alert(`Success: Rotated Master Key to KEK version ${res.kek_version}. All cards in the SQLite vault have been re-wrapped with the new KEK.`);
    } catch (err) {
      alert("Key Rotation failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setRotateLoading(false);
    }
  };

  useEffect(() => {
    fetch(true);
    const id = setInterval(() => fetch(false), 2500);
    return () => clearInterval(id);
  }, [refreshTrigger]);

  useEffect(() => {
    let intervalId = null;
    if (isSimulating) {
      intervalId = setInterval(async () => {
        const merchants = [
          { name: 'Netflix', amount: 1200, category: 'subscription' },
          { name: 'Spotify', amount: 450, category: 'subscription' },
          { name: 'Daraz', amount: 3500, category: 'general' },
          { name: 'CryptoBazaar.io', amount: 45000, category: 'investment' }
        ];
        const m = merchants[Math.floor(Math.random() * merchants.length)];
        const device_known = Math.random() > 0.3;
        const location_match = Math.random() > 0.2;
        const past_transactions = Math.floor(Math.random() * 12);
        
        try {
          setSimLogText(`Issuing token for ${m.name}...`);
          const tok = await generateToken(m.name, m.amount, 'PKR', 300);
          
          const masked = `${tok.token.slice(0, 4)} **** **** ${tok.token.slice(12)}`;
          localStorage.setItem(`raw_${masked}`, tok.token);

          setSimLogText(`Settling ${m.name} payment...`);
          await pay(tok.token, m.name, m.amount, {
            device_known,
            location_match,
            past_transactions_with_merchant: past_transactions,
            merchant_category: m.category
          });
          setSimLogText(`Payment settled for ${m.name}!`);
          fetch(false);
        } catch (err) {
          setSimLogText(`Simulated payment failed.`);
        }
      }, 5000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isSimulating]);

  const [confirmKill, setConfirmKill] = useState({});
  const [toastMsg, setToastMsg] = useState('');

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const handleKill = async (e, tx) => {
    e.stopPropagation();
    
    // Inline confirmation logic (double-click within 3 seconds)
    if (!confirmKill[tx.transaction_id]) {
      setConfirmKill(prev => ({ ...prev, [tx.transaction_id]: true }));
      // Auto-reset after 3 seconds
      setTimeout(() => {
        setConfirmKill(prev => ({ ...prev, [tx.transaction_id]: false }));
      }, 3000);
      return;
    }

    const raw = getRawToken(tx.token_masked);
    if (!raw) {
      showToast('Raw token not found in this session.');
      return;
    }
    setKilling(k => ({ ...k, [tx.transaction_id]: true }));
    try {
      await killToken(raw);
      await fetch(false);
      showToast(`Token for ${tx.merchant} destroyed successfully.`);
    } catch { 
      showToast('Failed to revoke token.'); 
    } finally { 
      setKilling(k => ({ ...k, [tx.transaction_id]: false })); 
      setConfirmKill(prev => ({ ...prev, [tx.transaction_id]: false }));
    }
  };

  const handleTriggerBreach = async () => {
    setBreachLoading(true);
    setBreachConsoleLogs([]);
    setBreachData(null);
    setShowBreachModal(true);

    const logs = [
      `[SYS] Initiating vulnerability scanner on '${breachMerchant}' endpoints...`,
      `[SYS] PORT 443 detected open. Exploiting SSL heartbeat buffer overflow...`,
      `[SYS] Privilege escalation achieved. Injecting payload into database instance...`,
      `[SYS] Table identified: 'user_billing_profiles'. Dumping data...`,
      `[SYS] Data dump completed. Extracting compromised billing credentials...`
    ];

    for (let i = 0; i < logs.length; i++) {
      await new Promise(r => setTimeout(r, 500));
      setBreachConsoleLogs(prev => [...prev, logs[i]]);
    }

    try {
      const data = await simulateBreach(breachMerchant);
      setBreachData(data);
    } catch (err) {
      setBreachConsoleLogs(prev => [...prev, `[ERR] Breach extraction failed or token database is empty.`]);
    } finally {
      setBreachLoading(false);
    }
  };

  const total = txns.length;
  const approved = txns.filter(t => t.decision === 'approve').length;
  const declined = txns.filter(t => t.decision === 'decline').length;
  const stepUp = txns.filter(t => t.decision === 'step_up').length;
  const avgRisk = total > 0
    ? Math.round(txns.reduce((a, t) => a + (t.risk_score || 0), 0) / total)
    : 0;

  const hasMetrics = txns.some(t => t.latency_ms);
  const avgLatency = hasMetrics
    ? Math.round(txns.filter(t => t.latency_ms).reduce((a, t) => a + t.latency_ms, 0) / txns.filter(t => t.latency_ms).length)
    : 0;
  const totalPromptTokens = txns.reduce((a, t) => a + (t.prompt_tokens || 0), 0);
  const totalCompletionTokens = txns.reduce((a, t) => a + (t.completion_tokens || 0), 0);
  const totalTokens = totalPromptTokens + totalCompletionTokens;
  const costSavings = ((totalTokens * 0.0135) / 1000).toFixed(4);

  const latencies = txns
    .filter(t => t.latency_ms)
    .slice(0, 10)
    .map(t => t.latency_ms)
    .reverse();

  const fmt = (iso) => {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch { return iso; }
  };

  const activeTokens = Object.values(
    txns.reduce((acc, tx) => {
      if (tx.token_status !== 'killed') {
        const elapsed = (Date.now() - new Date(tx.timestamp).getTime()) / 1000;
        if (elapsed < 300) {
          if (!acc[tx.token_masked] || tx.timestamp > acc[tx.token_masked].timestamp) {
            acc[tx.token_masked] = tx;
          }
        }
      }
      return acc;
    }, {})
  ).filter(t => !!getRawToken(t.token_masked));

  return (
    <div className="space-y-6">

      {/* Live Traffic Simulator Control Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 card border border-border bg-surface-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Live Traffic Simulator</h2>
          <p className="text-2xs text-ink-3">Automatically trigger transaction streams to demonstrate AI agent rules in real-time</p>
        </div>
        <div className="flex items-center gap-3">
          {isSimulating && (
            <span className="text-2xs text-accent font-mono animate-pulse shrink-0">
              ● {simLogText || 'Active...'}
            </span>
          )}
          <button
            onClick={() => setIsSimulating(!isSimulating)}
            className={`btn py-1.5 px-4 text-xs font-semibold rounded-btn transition-colors cursor-pointer ${
              isSimulating
                ? 'bg-ok text-white hover:bg-emerald-600'
                : 'bg-surface border border-ink-4 text-ink hover:bg-surface-3'
            }`}
          >
            {isSimulating ? 'Stop Simulator' : 'Start Simulator'}
          </button>
        </div>
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total analyzed', value: total, sub: 'transactions' },
          { label: 'Approved', value: approved, sub: `${total ? Math.round(approved/total*100) : 0}% approval rate`, valueClass: 'text-ok' },
          { label: 'Declined', value: declined, sub: `${total ? Math.round(declined/total*100) : 0}% block rate`, valueClass: 'text-bad' },
          { label: 'Avg AI risk score', value: total ? avgRisk : '-', sub: 'out of 100', valueClass: avgRisk < 30 ? 'text-ok' : avgRisk < 70 ? 'text-warn' : 'text-bad' },
        ].map((m) => (
          <div key={m.label} className="card p-5">
            <p className="eyebrow mb-2">{m.label}</p>
            <p className={`text-3xl font-bold tabular-nums ${m.valueClass || 'text-ink'}`}>{m.value}</p>
            <p className="text-2xs text-ink-3 mt-1">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* AMD Telemetry Panel */}
      <div className="card p-5 border border-accent-border bg-accent-muted">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-accent flex items-center justify-center text-white shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">AMD ROCm & Fireworks Telemetry</h3>
              <p className="text-2xs text-ink-3 font-mono">Hardware: AMD MI300X Accelerator · Platform: Fireworks AI Cloud</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
            {latencies.length >= 2 && <LatencySparkline latencies={latencies} />}
            <div className="grid grid-cols-3 gap-3 sm:gap-6 font-mono text-left sm:text-right w-full sm:w-auto">
              <div>
                <div className="text-2xs text-ink-3 font-sans font-medium uppercase tracking-wider">Avg Latency</div>
                <div className="text-base font-bold text-accent">{hasMetrics ? `${avgLatency}ms` : '—'}</div>
              </div>
              <div>
                <div className="text-2xs text-ink-3 font-sans font-medium uppercase tracking-wider">Total Tokens</div>
                <div className="text-base font-bold text-ink">{totalTokens}</div>
              </div>
              <div>
                <div className="text-2xs text-ink-3 font-sans font-medium uppercase tracking-wider">Local Cost Saved</div>
                <div className="text-base font-bold text-ok">${costSavings}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KMS & Circuit Breaker Control Center */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* KMS Security Card */}
        <div className="card p-5 border border-border bg-surface-2 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">🔐</span>
              <div>
                <h3 className="text-sm font-semibold text-ink">KMS Vault Key Manager</h3>
                <p className="text-2xs text-ink-3">Envelope Encryption & Master Key Wrapping</p>
              </div>
            </div>
            {vaultTelemetry && (
              <span className="badge badge-accent uppercase font-mono tracking-wider text-2xs py-1 px-2.5">
                KEK Version: {vaultTelemetry.kek_version}
              </span>
            )}
          </div>
          
          <div className="flex items-center justify-between gap-4 mt-2">
            <div className="text-2xs text-ink-3 font-mono">
              <p>Algorithm: AES-256-GCM Envelope</p>
              <p>Storage: Write-Once-Read-Many (WORM) SQLite</p>
            </div>
            <button
              onClick={handleRotateKeys}
              disabled={rotateLoading}
              className="btn bg-accent text-white hover:bg-accent-focus text-xs font-semibold py-1.5 px-3.5 rounded-btn disabled:opacity-50 shrink-0 cursor-pointer"
            >
              {rotateLoading ? 'Rotating...' : 'Rotate Master Key (KMS)'}
            </button>
          </div>
        </div>

        {/* Circuit Breaker Status Card */}
        <div className="card p-5 border border-border bg-surface-2 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">🔌</span>
              <div>
                <h3 className="text-sm font-semibold text-ink">API Circuit Breaker</h3>
                <p className="text-2xs text-ink-3">Fireworks AI Connectivity Telemetry</p>
              </div>
            </div>
            {cbTelemetry && (
              <span className={`badge uppercase font-mono tracking-wider text-2xs py-1 px-2.5 ${
                cbTelemetry.state === 'closed' ? 'badge-ok' :
                cbTelemetry.state === 'half-open' ? 'badge-warn' : 'badge-bad'
              }`}>
                {cbTelemetry.state}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 mt-2">
            <div className="text-2xs text-ink-3 font-mono">
              <p>Consecutive Failures: {cbTelemetry ? cbTelemetry.failure_count : 0} / 3</p>
              <p>Recovery Window: 30 seconds</p>
            </div>
            <div className="flex items-center gap-1.5 text-2xs font-semibold">
              <span className={`w-2.5 h-2.5 rounded-full ${cbTelemetry && cbTelemetry.state === 'closed' ? 'bg-ok animate-pulse' : 'bg-bad animate-pulse'}`} />
              <span className="text-ink-2">{cbTelemetry && cbTelemetry.state === 'closed' ? 'API Available' : 'Failing Over to Local ML'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Distribution & Breach Simulator Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Distribution bar (3 cols) */}
        <div className="lg:col-span-3 card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-ink">Decision breakdown</p>
              <div className="flex items-center gap-4 text-2xs text-ink-3">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-ok inline-block" />{approved} approved</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warn inline-block" />{stepUp} verification</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-bad inline-block" />{declined} declined</span>
              </div>
            </div>
            <p className="text-2xs text-ink-3 mb-4 leading-relaxed">
              Distribution of risk assessment decisions processed during this active session.
            </p>
          </div>
          <div className="flex h-2 rounded-pill overflow-hidden gap-0.5">
            {approved > 0 && <div className="bg-ok transition-all" style={{ width: `${approved/total*100}%` }} />}
            {stepUp > 0 && <div className="bg-warn transition-all" style={{ width: `${stepUp/total*100}%` }} />}
            {declined > 0 && <div className="bg-bad transition-all" style={{ width: `${declined/total*100}%` }} />}
            {total === 0 && <div className="bg-ink-5 w-full" />}
          </div>
        </div>

        {/* Breach Simulator console entry (2 cols) */}
        <div className="lg:col-span-2 card p-5 flex flex-col justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink mb-1">Merchant Breach Simulator</h3>
            <p className="text-2xs text-ink-3 leading-relaxed">
              Simulate a server breach on a merchant to contrast credit card leakage risks.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={breachMerchant}
              onChange={(e) => setBreachMerchant(e.target.value)}
              className="flex-1 bg-surface border border-ink-4 rounded-btn px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
            >
              {getSimulatedMerchants().map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button
              onClick={handleTriggerBreach}
              className="btn-primary py-1.5 px-3 text-xs bg-bad hover:bg-red-700"
            >
              Trigger Breach
            </button>
          </div>
        </div>
      </div>

      {/* Cryptographic WORM Ledger Feed */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⛓️</span>
            <h2 className="text-sm font-semibold text-ink">Cryptographic WORM Ledger (WORM Log)</h2>
            <span className="badge badge-neutral">{ledgerEvents.length} blocks</span>
          </div>
          <div className="flex items-center gap-1.5 text-2xs font-semibold text-ok">
            <span className="w-2.5 h-2.5 rounded-full bg-ok animate-pulse" />
            <span>Chain Integrity Verified (Append-Only ledger)</span>
          </div>
        </div>

        <div className="max-h-[300px] overflow-y-auto divide-y divide-border">
          {ledgerEvents.length === 0 ? (
            <div className="p-8 text-center text-ink-3 text-xs italic">
              No blocks recorded in the WORM audit trail yet.
            </div>
          ) : (
            [...ledgerEvents].reverse().map((block) => (
              <div key={block.log_index} className="px-5 py-4 hover:bg-surface-2 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono bg-surface-3 border border-border px-2 py-0.5 rounded text-ink font-semibold">
                    #{block.log_index}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-ink">{block.action}</span>
                      <span className="badge badge-ok font-mono text-3xs py-0 px-1">
                        Verified
                      </span>
                    </div>
                    <div className="text-3xs text-ink-3 font-mono mt-0.5">{block.timestamp}</div>
                  </div>
                </div>
                
                <div className="flex-1 font-mono text-3xs text-ink-3 truncate max-w-lg md:mx-6">
                  Payload: {JSON.stringify(block.payload)}
                </div>

                <div className="shrink-0 font-mono text-3xs text-right text-ink-4">
                  <p className="truncate w-36 text-ink-3">Block: {block.block_hash.slice(0, 16)}...</p>
                  <p className="truncate w-36">Prev: {block.previous_hash.slice(0, 16)}...</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Active Subscriptions (Kill Switch) */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            <h2 className="text-sm font-semibold text-ink">Active Subscriptions Manager (Kill Switch)</h2>
            <span className="badge badge-neutral">{activeTokens.length}</span>
          </div>
        </div>

        {activeTokens.length === 0 ? (
          <div className="p-8 text-center text-ink-3 text-xs italic">
            No active tokens found in this browser session.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
            {activeTokens.map(tx => {
              const isKilling = !!killing[tx.transaction_id];
              return (
                <div key={tx.token_masked} className="bg-surface-2 border border-border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-ink">{tx.merchant}</span>
                    <span className="text-xs font-mono font-medium text-ink-2">{tx.amount} PKR</span>
                  </div>
                  <div className="text-2xs font-mono text-ink-4 mb-4">{tx.token_masked}</div>
                  
                  <div className="flex justify-end mt-4 pt-3 border-t border-border">
                    <button
                      onClick={(e) => handleKill(e, tx)}
                      disabled={isKilling}
                      className={`btn-primary py-1.5 px-3 text-xs flex items-center gap-1.5 transition-all duration-200 ${
                        confirmKill[tx.transaction_id] 
                          ? 'bg-warn hover:bg-amber-700 text-white' 
                          : 'bg-bad hover:bg-red-700 text-white'
                      }`}
                    >
                      {isKilling ? (
                        <span className="spinner" style={{width: 14, height: 14}} />
                      ) : confirmKill[tx.transaction_id] ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      {confirmKill[tx.transaction_id] ? 'Confirm Destroy?' : 'Destroy Token'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Transaction table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="live-dot" style={{ color: '#059669' }} />
            <h2 className="text-sm font-semibold text-ink">Transaction feed</h2>
            <span className="badge badge-neutral">{total}</span>
          </div>
          <button
            onClick={() => fetch(true)}
            disabled={loading}
            className="btn-ghost text-ink-3 hover:text-ink"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>

        {txns.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-3 flex items-center justify-center mx-auto mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-ink mb-1">No transactions yet</p>
            <p className="text-xs text-ink-3">Generate a token and complete a payment to see results here.</p>
          </div>
        ) : (
          <>
            {/* Table head */}
            <div className="hidden lg:grid grid-cols-12 gap-4 px-5 py-2.5 bg-surface-2 border-b border-border text-2xs font-semibold uppercase tracking-wider text-ink-3">
              <div className="col-span-2">Decision</div>
              <div className="col-span-2">Merchant</div>
              <div className="col-span-2">Amount</div>
              <div className="col-span-3">Risk score</div>
              <div className="col-span-2">Time</div>
              <div className="col-span-1"></div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-border">
              {txns.map((tx) => {
                const isExpanded = expanded === tx.transaction_id;
                const canKill = tx.token_status !== 'killed' && !!getRawToken(tx.token_masked);
                const isKilling = !!killing[tx.transaction_id];

                return (
                  <div key={tx.transaction_id} className="row-in">
                    <div
                      onClick={() => setExpanded(isExpanded ? null : tx.transaction_id)}
                      className={`grid grid-cols-12 gap-4 px-5 py-4 items-center cursor-pointer transition-colors duration-100 ${
                        isExpanded ? 'bg-surface-2' : 'hover:bg-surface-2'
                      }`}
                    >
                      {/* Decision badge */}
                      <div className="col-span-6 lg:col-span-2 flex items-center gap-2">
                        <DecisionBadge decision={tx.decision} />
                      </div>

                      {/* Merchant */}
                      <div className="hidden lg:flex col-span-2 items-center">
                        <span className="text-sm font-medium text-ink truncate">{tx.merchant}</span>
                      </div>

                      {/* Amount */}
                      <div className="hidden lg:flex col-span-2 items-center">
                        <span className="text-sm font-mono text-ink-2">
                          {tx.amount?.toLocaleString()} PKR
                        </span>
                      </div>

                      {/* Risk bar */}
                      <div className="col-span-4 lg:col-span-3">
                        <RiskBar score={tx.risk_score} />
                      </div>

                      {/* Time */}
                      <div className="hidden lg:flex col-span-2 items-center text-2xs font-mono text-ink-3">
                        {fmt(tx.timestamp)}
                      </div>

                      {/* Actions */}
                      <div className="col-span-2 lg:col-span-1 flex items-center justify-end gap-1">
                        <div className="text-ink-4 ml-1">
                          {isExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-5 pb-5 bg-surface-2 border-t border-border row-in">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-4">
                          {/* AI explanation */}
                          <div className="bg-surface border border-border rounded-card p-4 flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <p className="eyebrow">AI Risk Explanation</p>
                                <span className="text-2xs font-mono text-ink-3">{tx.model?.split('/').pop()}</span>
                              </div>
                              <p className="text-xs text-ink-2 leading-relaxed">{tx.explanation}</p>
                            </div>
                            <div className="text-3xs text-ink-4 mt-4 font-mono">
                              * XGBoost score enqueued post-auth Explainable AI deep analysis.
                            </div>
                          </div>

                          {/* Feast Online Features */}
                          <div className="bg-surface border border-border rounded-card p-4">
                            <div className="flex items-center justify-between mb-3">
                              <p className="eyebrow">Feast Online Feature Store</p>
                              <span className="badge badge-accent uppercase font-mono text-3xs">FEAST ONLINE</span>
                            </div>
                            <div className="space-y-0">
                              {[
                                ['Retrieval Latency', tx.features?.feature_retrieval_latency_ms ? `${tx.features.feature_retrieval_latency_ms}ms` : '0.14ms'],
                                ['User Velocity (30m)', tx.features?.user_velocity_30m ?? 0],
                                ['User Velocity (24h)', tx.features?.user_velocity_24h ?? 0],
                                ['Average Amount (24h)', tx.features?.average_amount_24h ? `${tx.features.average_amount_24h} PKR` : '0 PKR'],
                                ['Device Age', tx.features?.device_age_days ? `${tx.features.device_age_days} days` : '0 days'],
                                ['Location Mismatch (7d)', tx.features?.location_mismatch_count_7d ?? 0],
                              ].map(([k, v]) => (
                                <div key={k} className="data-row text-xs">
                                  <span className="text-ink-3">{k}</span>
                                  <span className="font-mono font-medium text-ink">{v}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Transaction metadata */}
                          <div className="bg-surface border border-border rounded-card p-4">
                            <p className="eyebrow mb-3">Transaction details</p>
                            <div className="space-y-0">
                              {[
                                ['Token (masked)', tx.token_masked],
                                ['Status', tx.token_status],
                                ['Device recognized', tx.metadata?.device_known ? 'Yes' : 'No'],
                                ['Location matched', tx.metadata?.location_match ? 'Yes' : 'No'],
                                ['KMS Key Version', tx.kek_version ? `KEK v${tx.kek_version}` : 'KEK v1'],
                              ].map(([k, v]) => (
                                <div key={k} className="data-row text-xs">
                                  <span className="text-ink-3">{k}</span>
                                  <span className="font-mono font-medium text-ink">{v}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <p className="text-2xs text-ink-4 font-mono mt-3">
                          Inference on AMD MI300X via Fireworks AI - txn {tx.transaction_id}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {showBreachModal && (
        <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-ink-4 rounded-card max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl row-in">
            {/* Modal header */}
            <div className="px-5 py-4 border-b border-ink-5 flex items-center justify-between bg-surface-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-bad animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-wider text-ink">Breach Simulator: {breachMerchant}</span>
              </div>
              <button
                onClick={() => setShowBreachModal(false)}
                className="text-ink hover:text-bad text-xs font-semibold uppercase border border-ink-4 px-2.5 py-1 rounded bg-surface hover:bg-bad-muted transition-colors cursor-pointer"
              >
                Close Console
              </button>
            </div>

            {/* Hacker terminal & logs */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1 bg-ink text-green-400 font-mono text-xs">
              <div className="space-y-1">
                {breachConsoleLogs.map((log, index) => (
                  <div key={index} className="row-in">{log}</div>
                ))}
                {breachLoading && (
                  <div className="flex items-center gap-2 mt-2 text-white">
                    <span className="spinner" />
                    <span>Extracting DB records...</span>
                  </div>
                )}
              </div>

              {/* Contrast display once data loaded */}
              {!breachLoading && breachData && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 text-ink row-in font-sans">
                  {/* Left column: Without SecurePay (Exposed raw PANs) */}
                  <div className="bg-bad-muted border border-bad-border rounded-card p-4">
                    <h4 className="text-xs font-bold text-bad uppercase tracking-wider mb-3">WITHOUT SECUREPAY (Exposed DB)</h4>
                    {breachData.exposed_records_without_securepay.length === 0 ? (
                      <p className="text-2xs text-ink-3 italic">No transaction records found for this merchant.</p>
                    ) : (
                      <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
                        {breachData.exposed_records_without_securepay.map((rec, i) => (
                          <div key={i} className="bg-surface border border-bad-border rounded p-3 text-2xs space-y-1">
                            <div className="flex justify-between font-mono font-medium text-ink">
                              <span>PAN: {rec.pan}</span>
                              <span className="text-bad font-semibold">CVV: {rec.cvv}</span>
                            </div>
                            <div className="flex justify-between text-ink-3 font-mono">
                              <span>Holder: {rec.cardholder}</span>
                              <span>Exp: {rec.expiry}</span>
                            </div>
                            <div className="text-bad text-3xs font-semibold uppercase tracking-wider pt-1 border-t border-bad-border/40">
                              Risk: {rec.financial_risk}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right column: With SecurePay (Safe tokens) */}
                  <div className="bg-ok-muted border border-ok-border rounded-card p-4">
                    <h4 className="text-xs font-bold text-ok uppercase tracking-wider mb-3">WITH SECUREPAY (Protected DB)</h4>
                    {breachData.exposed_records_with_securepay.length === 0 ? (
                      <p className="text-2xs text-ink-3 italic">No token interactions detected for this merchant.</p>
                    ) : (
                      <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
                        {breachData.exposed_records_with_securepay.map((rec, i) => (
                          <div key={i} className="bg-surface border border-ok-border rounded p-3 text-2xs space-y-1">
                            <div className="flex justify-between font-mono font-medium text-ink">
                              <span>Token: {rec.token_masked}</span>
                              <span className="text-ok font-semibold">Protected</span>
                            </div>
                            <div className="text-ink-3 font-mono">
                              Lock: Merchant-Locked (Exclusive constraint)
                            </div>
                            <div className="text-ok text-3xs font-semibold uppercase tracking-wider pt-1 border-t border-ok-border/40">
                              Risk: {rec.financial_risk}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink-2 text-white px-6 py-3 rounded-card text-sm font-medium shadow-xl z-50 animate-in fade-in slide-in-from-bottom-4">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
