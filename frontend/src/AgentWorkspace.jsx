import React, { useState, useEffect, useRef } from 'react';
import { agentChat } from './api';

export default function AgentWorkspace({ lastTxn, onStatusUpdated }) {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [showBiometricModal, setShowBiometricModal] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState('idle'); // idle | scanning | success
  const [pendingAction, setPendingAction] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (lastTxn) {
      // Set initial agent greeting based on the blocked transaction status
      const greeting = `[Agent] Flagged transaction detected (ID: ${lastTxn.transaction_id}). Merchant: ${lastTxn.merchant}, Amount: ${lastTxn.amount} PKR. Status: ${lastTxn.decision.toUpperCase()}. Reason: "${lastTxn.explanation}". How would you like me to proceed with security override?`;
      setHistory([
        { sender: 'agent', text: greeting }
      ]);
      setTerminalLogs([
        `[SYS] Loaded Transaction Context ID: ${lastTxn.transaction_id}`,
        `[SYS] Current Risk Assessment: ${lastTxn.decision.toUpperCase()}`,
        `[SYS] Secure Vault Key Check: OK (AES-256)`,
        `[SYS] Waiting for user confirmation or override instructions...`
      ]);
    } else {
      setHistory([
        { sender: 'agent', text: "Welcome to the AI Agent Workspace. No flagged transactions are active. Switch to the Checkout tab to generate and process a payment first." }
      ]);
      setTerminalLogs([
        `[SYS] Idle state - Listening for flagged transactions...`
      ]);
    }
  }, [lastTxn]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    const userMsg = message;
    setMessage('');
    setHistory(prev => [...prev, { sender: 'user', text: userMsg }]);
    setLoading(true);

    const activeTxn = lastTxn || {
      transaction_id: "general_inquiry",
      token: "0000000000000000",
      merchant: "General Support",
      amount: 0.0,
      decision: "step_up",
      explanation: "General assistant mode."
    };

    setTerminalLogs(prev => [
      ...prev,
      `[SYS] Forwarding input to AI Risk Analyst Agent...`,
      `[SYS] Message: "${userMsg}"`
    ]);

    try {
      const res = await agentChat(userMsg, activeTxn.transaction_id, activeTxn.token);
      
      // Update terminal logs with the agent's chain of thought
      if (res.thought) {
        setTerminalLogs(prev => [
          ...prev,
          `[THOUGHT] ${res.thought}`,
          res.action && res.action !== 'null' ? `[ACTION EXECUTED] ${res.action.toUpperCase()}` : `[ACTION] No database changes needed.`
        ]);
      }

      setHistory(prev => [...prev, {
        sender: 'agent',
        text: res.reply || "I have processed your request.",
        thought: res.thought
      }]);

      if (res.action === 'resume_token' || res.action === 'increase_limit') {
        if (lastTxn) {
          setPendingAction(res.action);
          setShowBiometricModal(true);
        }
      }
    } catch (err) {
      setTerminalLogs(prev => [
        ...prev,
        `[ERR] Connection to AI Agent failed or timed out.`
      ]);
      setHistory(prev => [...prev, {
        sender: 'agent',
        text: "I encountered a communication exception resolving your override request. Let me check the connection."
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch min-h-[550px]">
      
      {/* LEFT COLUMN - Agent Reasoning Terminal (Chain-of-Thought logs) */}
      <div className="lg:col-span-2 flex flex-col bg-ink text-green-400 p-5 rounded-card border border-ink-4 font-mono text-xs overflow-hidden shadow-lg select-none">
        <div className="flex items-center justify-between pb-3 border-b border-ink-5 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded bg-green-500/20 flex items-center justify-center">
              <span className="live-dot" style={{color:'#22c55e', width:5, height:5}} />
            </div>
            <span className="text-2xs font-semibold tracking-wider uppercase text-green-300">Agent Reasoning Console</span>
          </div>
          <span className="text-3xs text-ink-3 uppercase">AI CoT Log</span>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[450px]">
          {terminalLogs.map((log, index) => {
            const isSystem = log.startsWith('[SYS]');
            const isThought = log.startsWith('[THOUGHT]');
            const isAction = log.startsWith('[ACTION EXECUTED]');
            const isErr = log.startsWith('[ERR]');
            
            let colorCls = "text-ink-3";
            if (isSystem) colorCls = "text-green-500/80";
            if (isThought) colorCls = "text-green-400 font-sans italic pl-3 border-l border-green-500/30";
            if (isAction) colorCls = "text-amber-400 font-bold tracking-wide";
            if (isErr) colorCls = "text-bad font-semibold";
            
            return (
              <div key={index} className="row-in leading-relaxed text-2xs">
                {log}
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT COLUMN - Interactive Chat Panel */}
      <div className="lg:col-span-3 card p-5 flex flex-col justify-between shadow-sm relative overflow-hidden">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">AI Security Analyst</h3>
              <p className="text-2xs text-ink-3">Ask questions or confirm transactions to override security policies</p>
            </div>
            {lastTxn && (
              <span className="badge badge-warn text-3xs font-mono uppercase">
                Override Target: {lastTxn.token_masked}
              </span>
            )}
          </div>
        </div>

        {lastTxn ? (
          <>
            {/* Chat History Feed */}
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1 min-h-[300px] max-h-[380px]">
              {history.map((msg, i) => {
                const isAgent = msg.sender === 'agent';
                return (
                  <div key={i} className={`flex ${isAgent ? 'justify-start' : 'justify-end'} row-in`}>
                    <div className={`max-w-[85%] rounded-card p-3.5 text-xs leading-relaxed ${
                      isAgent
                        ? 'bg-surface-3 border border-border text-ink'
                        : 'bg-accent text-white font-medium'
                    }`}>
                      <div className={`text-3xs font-semibold uppercase tracking-wider mb-1 ${
                        isAgent ? 'text-accent' : 'text-white/80'
                      }`}>
                        {isAgent ? 'AI Agent' : 'You'}
                      </div>
                      <p>{msg.text}</p>
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="flex justify-start row-in">
                  <div className="bg-surface-3 border border-border rounded-card p-3 text-xs flex items-center gap-2">
                    <span className="spinner" style={{width:12, height:12}} />
                    <span className="text-ink-3 font-mono text-2xs">Analyst is thinking...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Message Input Form */}
            <form onSubmit={handleSend} className="flex gap-2 border-t border-border pt-4">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type 'yes' to authorize this payment, or ask a question..."
                disabled={loading}
                className="flex-1 bg-surface border border-ink-4 rounded-btn px-4 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={loading || !message.trim()}
                className="btn-primary py-2 px-5 text-xs shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 opacity-60">
            <div className="w-16 h-16 rounded-full bg-surface-3 flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-ink mb-1">No Active Incident</p>
            <p className="text-xs text-ink-3 max-w-[250px]">
              The AI Agent is idle. Generate a token and trigger a decline in the Checkout tab to see the Agent in action.
            </p>
          </div>
        )}

      </div>

      {/* MFA Biometric Modal */}
      {showBiometricModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface border border-border p-8 rounded-2xl w-full max-w-sm flex flex-col items-center justify-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-surface-3 flex items-center justify-center mb-6 relative overflow-hidden">
               {biometricStatus === 'scanning' && (
                 <div className="absolute inset-0 bg-accent/20 animate-pulse" />
               )}
               {biometricStatus === 'success' ? (
                 <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-ok" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                 </svg>
               ) : (
                 <svg xmlns="http://www.w3.org/2000/svg" className={`w-8 h-8 ${biometricStatus === 'scanning' ? 'text-accent' : 'text-ink'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                   <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5zM13.5 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" />
                   <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                 </svg>
               )}
            </div>
            
            <h2 className="text-lg font-bold text-ink mb-2">Biometric Authorization</h2>
            <p className="text-xs text-ink-3 text-center mb-6">
              AI Security protocol requires hardware-level biometric confirmation to execute token override for <strong>{lastTxn?.merchant}</strong>.
            </p>
            
            <button
              onClick={() => {
                if (biometricStatus !== 'idle') return;
                setBiometricStatus('scanning');
                setTimeout(() => {
                  setBiometricStatus('success');
                  setTimeout(() => {
                    setTerminalLogs(prev => [
                      ...prev,
                      `[SYS] Hardware Biometric Verification: OK`,
                      `[SYS] Applying Override Action: ${pendingAction?.toUpperCase()}`,
                      `[SYS] Token rule updated in Redis. Current state: ACTIVE / White-listed.`
                    ]);
                    onStatusUpdated?.();
                    setShowBiometricModal(false);
                    setBiometricStatus('idle');
                    setPendingAction(null);
                  }, 1000);
                }, 2000);
              }}
              disabled={biometricStatus !== 'idle'}
              className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all ${
                biometricStatus === 'scanning' 
                  ? 'bg-accent/20 text-accent border border-accent' 
                  : biometricStatus === 'success'
                  ? 'bg-ok text-white'
                  : 'bg-accent text-white hover:bg-accent/90'
              }`}
            >
              {biometricStatus === 'scanning' ? 'Scanning Face ID...' : biometricStatus === 'success' ? 'Authorized' : 'Scan Face ID'}
            </button>
            <button
              onClick={() => setShowBiometricModal(false)}
              className="mt-4 text-xs text-ink-4 hover:text-ink underline"
            >
              Cancel Override
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
