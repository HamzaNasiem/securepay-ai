import React, { useState, useEffect } from 'react';
import Checkout from './Checkout';
import Dashboard from './Dashboard';
import AgentWorkspace from './AgentWorkspace';
import Login from './Login';
import WalletSetup from './WalletSetup';
import { getHealth, getWalletStatus } from './api';

export default function App() {
  const [appView, setAppView] = useState('loading'); // 'loading' | 'login' | 'wallet' | 'app'
  
  const getTabFromHash = () => {
    const hash = window.location.hash;
    if (hash === '#/agent' || hash === '#agent') return 'agent';
    if (hash === '#/dashboard' || hash === '#dashboard') return 'dashboard';
    return 'checkout';
  };

  const [activeTab, setActiveTab] = useState(getTabFromHash());
  const [healthStatus, setHealthStatus] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [lastTxn, setLastTxn] = useState(null);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = '#/checkout';
    }
    const handleHashChange = () => {
      setActiveTab(getTabFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const loggedIn = localStorage.getItem('isLoggedIn') === 'true';
      if (!loggedIn) {
        setAppView('login');
        return;
      }
      try {
        const status = await getWalletStatus();
        if (status.has_master_card) {
          setAppView('app');
        } else {
          setAppView('wallet');
        }
      } catch (err) {
        setAppView('login');
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const data = await getHealth();
        setHealthStatus(data);
      } catch {
        setHealthStatus({ status: 'error', redis: 'disconnected' });
      }
    };
    check();
    const id = setInterval(check, 6000);
    return () => clearInterval(id);
  }, []);

  const handleTransactionComplete = (txnDetails) => {
    setRefreshTrigger(n => n + 1);
    if (txnDetails) {
      setLastTxn(txnDetails);
      // Automatically switch to Agent Workspace to consult override if flagged
      if (txnDetails.decision !== 'approve') {
        window.location.hash = '#/agent';
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('isLoggedIn');
    setAppView('login');
  };

  const redisOk = healthStatus?.redis === 'connected';
  const backendOk = healthStatus?.status !== 'error' && healthStatus !== null;

  if (appView === 'loading') {
    return (
      <div className="min-h-screen bg-[#111] flex items-center justify-center">
        <span className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (appView === 'login') {
    return <Login onLogin={async () => {
      try {
        const status = await getWalletStatus();
        if (status.has_master_card) {
          setAppView('app');
        } else {
          setAppView('wallet');
        }
      } catch {
        setAppView('wallet');
      }
    }} />;
  }

  if (appView === 'wallet') {
    return <WalletSetup onComplete={() => setAppView('app')} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-2">

      {/* Top navigation */}
      <header className="bg-surface border-b border-border sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-6">

          {/* Wordmark */}
          <a href="#" className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 bg-accent rounded-btn flex items-center justify-center text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-ink tracking-tight">SecurePay AI</span>
          </a>

          {/* Tab nav */}
          <nav className="flex items-center gap-1">
            <button
              onClick={() => window.location.hash = '#/checkout'}
              className={`px-4 py-2 text-sm font-medium rounded-btn transition-colors duration-150 ${
                activeTab === 'checkout'
                  ? 'bg-surface-3 text-ink'
                  : 'text-ink-3 hover:text-ink hover:bg-surface-3'
              }`}
            >
              Checkout
            </button>
            <button
              onClick={() => window.location.hash = '#/agent'}
              className={`px-4 py-2 text-sm font-medium rounded-btn transition-colors duration-150 relative ${
                activeTab === 'agent'
                  ? 'bg-surface-3 text-ink'
                  : 'text-ink-3 hover:text-ink hover:bg-surface-3'
              }`}
            >
              Agent Workspace
              {lastTxn && lastTxn.decision !== 'approve' && lastTxn.token_status !== 'active' && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-bad animate-pulse" />
              )}
            </button>
            <button
              onClick={() => window.location.hash = '#/dashboard'}
              className={`px-4 py-2 text-sm font-medium rounded-btn transition-colors duration-150 relative ${
                activeTab === 'dashboard'
                  ? 'bg-surface-3 text-ink'
                  : 'text-ink-3 hover:text-ink hover:bg-surface-3'
              }`}
            >
              Risk Dashboard
              {refreshTrigger > 0 && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent" />
              )}
            </button>
          </nav>

          {/* Status indicators */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5 text-2xs font-medium">
              <span
                className="live-dot"
                style={{ color: redisOk ? '#059669' : '#DC2626' }}
              />
              <span className={redisOk ? 'text-ok' : 'text-bad'}>
                Redis {redisOk ? 'connected' : 'offline'}
              </span>
            </div>
            <div className="w-px h-4 bg-border" />
            <div className="hidden sm:flex items-center gap-1.5 text-2xs text-ink-3 font-mono">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              AMD MI300X
            </div>
            <div className="w-px h-4 bg-border hidden sm:block" />
            <button
              onClick={handleLogout}
              className="text-2xs font-semibold text-bad hover:text-red-700 bg-bad-muted hover:bg-bad-muted/85 px-2.5 py-1.5 rounded transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Offline banner */}
      {healthStatus?.status === 'error' && (
        <div className="bg-bad-muted border-b border-bad-border px-6 py-2.5 flex items-center justify-center gap-2 text-sm text-bad">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          Backend server is unreachable. Start the backend on port 8080 and refresh.
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <div style={{ display: activeTab === 'checkout' ? 'block' : 'none' }}>
          <Checkout onTransactionComplete={handleTransactionComplete} />
        </div>
        <div style={{ display: activeTab === 'agent' ? 'block' : 'none' }}>
          <AgentWorkspace lastTxn={lastTxn} onStatusUpdated={() => setRefreshTrigger(n => n + 1)} />
        </div>
        <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
          <Dashboard refreshTrigger={refreshTrigger} />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-surface mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-2xs text-ink-3">
          <span>SecurePay AI - AMD Developer Hackathon Unicorn Track 2026</span>
          <div className="flex items-center gap-4 font-mono">
            <span>DeepSeek V4 Pro</span>
            <span className="text-border">|</span>
            <span>Fireworks AI</span>
            <span className="text-border">|</span>
            <span>FastAPI + Redis</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
