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
  const amdOnline = backendOk && redisOk;
  const currentYear = new Date().getFullYear();

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
    <div className="min-h-screen flex flex-col bg-surface-2 overflow-x-hidden w-full">

      {/* Top navigation */}
      <header className="bg-surface border-b border-border sticky top-0 z-50 w-full">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 md:py-0 md:h-16 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">

          {/* Wordmark */}
          <a href="#" className="flex items-center gap-2.5 shrink-0 self-start md:self-auto">
            <div className="w-8 h-8 bg-accent rounded-btn flex items-center justify-center text-white">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white">
                <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-sm font-semibold text-ink tracking-tight">SecurePay AI</span>
          </a>

          {/* Tab nav */}
          <nav className="flex items-center gap-1 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 scrollbar-hide">
            <button
              onClick={() => window.location.hash = '#/checkout'}
              className={`px-4 py-2 text-sm font-medium rounded-btn transition-colors duration-150 shrink-0 ${
                activeTab === 'checkout'
                  ? 'bg-surface-3 text-ink'
                  : 'text-ink-3 hover:text-ink hover:bg-surface-3'
              }`}
            >
              Checkout
            </button>
            <button
              onClick={() => window.location.hash = '#/agent'}
              className={`px-4 py-2 text-sm font-medium rounded-btn transition-colors duration-150 relative shrink-0 ${
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
              className={`px-4 py-2 text-sm font-medium rounded-btn transition-colors duration-150 relative shrink-0 ${
                activeTab === 'dashboard'
                  ? 'bg-surface-3 text-ink'
                  : 'text-ink-3 hover:text-ink hover:bg-surface-3'
              }`}
            >
              Risk Dashboard
            </button>
          </nav>

          {/* Status indicators */}
          <div className="flex flex-wrap justify-between md:justify-end items-center gap-3 shrink-0 w-full md:w-auto mt-1 md:mt-0">
            <div className="flex items-center gap-1.5 text-2xs font-medium">
              <span
                className="live-dot"
                style={{ color: redisOk ? '#059669' : '#DC2626' }}
              />
              <span className={redisOk ? 'text-ok' : 'text-bad'}>
                Redis {redisOk ? 'connected' : 'offline'}
              </span>
            </div>
            <div className="w-px h-4 bg-border hidden sm:block" />
            <div className="hidden sm:flex items-center gap-1.5 text-2xs font-medium">
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 ${amdOnline ? 'text-accent' : 'text-ink-4'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              <span className={amdOnline ? 'text-accent' : 'text-ink-4'}>
                AMD MI300X {amdOnline ? '· Active' : '· Offline'}
              </span>
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
        <div className="bg-bad-muted border-b border-bad-border px-4 sm:px-6 py-2.5 flex items-center justify-center gap-2 text-sm text-bad w-full text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0 hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>Backend server is unreachable — running in local simulation mode. Start the backend on port 8080 to enable live AI inference.</span>
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 overflow-hidden">
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
      <footer className="border-t border-border bg-surface mt-auto w-full">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-2xs text-ink-3">
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left">
            <span className="font-semibold text-ink-2">SecurePay AI</span>
            <span className="hidden sm:inline text-border">·</span>
            <span>AMD Developer Hackathon — Unicorn Track {currentYear}</span>
            <span className="hidden sm:inline text-border">·</span>
            <a
              href="/hackathon"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline font-medium"
            >
              imhamza.com/hackathon
            </a>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-2 sm:gap-4 font-mono">
            <span className={`flex items-center gap-1 ${amdOnline ? 'text-accent' : 'text-ink-4'}`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{backgroundColor: amdOnline ? '#c15f3c' : '#6b7280'}} />
              DeepSeek V4 Pro
            </span>
            <span className="text-border hidden sm:inline">|</span>
            <span>Fireworks AI</span>
            <span className="text-border hidden sm:inline">|</span>
            <span>FastAPI + Redis</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
