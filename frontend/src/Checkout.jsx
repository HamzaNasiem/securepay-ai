import React, { useState, useEffect, useRef } from 'react';
import { generateToken, pay, simulateMerchant, updateTokenStatus, updateTokenLimit, confirmPayment } from './api';

const ScrambleText = ({ text }) => {
  const [display, setDisplay] = useState('');
  
  useEffect(() => {
    if (!text) return;
    const chars = '0123456789*';
    let iter = 0;
    const interval = setInterval(() => {
      setDisplay(text.split('').map((c, i) => {
        if (c === ' ') return ' ';
        if (i < iter) return c;
        return chars[Math.floor(Math.random() * chars.length)];
      }).join(''));
      
      if (iter >= text.length) clearInterval(interval);
      iter += 1/3; // Speed of unscrambling
    }, 30);
    return () => clearInterval(interval);
  }, [text]);
  
  return <span>{display || text}</span>;
};

const AnimatedNumber = ({ value }) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (value === null || value === undefined) return;
    let start = 0;
    const duration = 1000;
    const stepTime = 20;
    const steps = duration / stepTime;
    const increment = value / steps;
    
    const timer = setInterval(() => {
      start += increment;
      if (start >= value) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(Math.floor(start));
      }
    }, stepTime);
    
    return () => clearInterval(timer);
  }, [value]);

  return <span>{displayValue}</span>;
};

const playSound = (type) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    if (type === 'success') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime);
      gain1.gain.setValueAtTime(0.12, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(783.99, ctx.currentTime + 0.07);
      gain2.gain.setValueAtTime(0.0, ctx.currentTime);
      gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.07);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc1.start();
      osc1.stop(ctx.currentTime + 0.35);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.45);
    } else if (type === 'error') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(130, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(90, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'click') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1500, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.015);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.02);
    }
  } catch (e) {
    console.error('Sound synthesis failed', e);
  }
};

const MERCHANTS = [
  {
    name: 'Netflix',
    amount: 1200,
    currency: 'PKR',
    category: 'subscription',
    device_known: true,
    location_match: true,
    past_transactions: 6,
    desc: 'Known device, matched location, returning user.',
    expected: 'approve',
  },
  {
    name: 'CryptoBazaar.io',
    amount: 45000,
    currency: 'PKR',
    category: 'crypto_exchange',
    device_known: false,
    location_match: false,
    past_transactions: 0,
    desc: 'Unknown device, foreign IP, no purchase history.',
    expected: 'decline',
  },
  {
    name: 'Spotify',
    amount: 450,
    currency: 'PKR',
    category: 'subscription',
    device_known: true,
    location_match: false,
    past_transactions: 2,
    desc: 'Known device but location mismatch detected.',
    expected: 'step_up',
  },
  {
    name: 'Daraz',
    amount: 3500,
    currency: 'PKR',
    category: 'ecommerce',
    device_known: true,
    location_match: true,
    past_transactions: 14,
    desc: 'Repeat buyer, consistent context, low risk.',
    expected: 'approve',
  },
  {
    name: 'Amazon AWS',
    amount: 15000,
    currency: 'PKR',
    category: 'cloud',
    device_known: true,
    location_match: true,
    past_transactions: 24,
    desc: 'High value but consistent monthly billing pattern.',
    expected: 'approve',
  },
  {
    name: 'Uber',
    amount: 850,
    currency: 'PKR',
    category: 'travel',
    device_known: false,
    location_match: true,
    past_transactions: 0,
    desc: 'New device but location matches typical patterns.',
    expected: 'step_up',
  },
  {
    name: 'Custom Merchant',
    amount: 5000,
    currency: 'PKR',
    category: 'retail',
    device_known: false,
    location_match: false,
    past_transactions: 0,
    desc: 'Test your own custom merchant simulation.',
    expected: 'step_up',
  }
];

const EXPECTED_LABELS = {
  approve: { label: 'Likely approved', cls: 'badge-ok' },
  decline: { label: 'Likely declined', cls: 'badge-bad' },
  step_up: { label: 'Likely verification', cls: 'badge-warn' },
};

function StepDot({ state }) {
  // state: 'done' | 'active' | 'idle'
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors duration-200 ${
      state === 'done'   ? 'bg-ok text-white border-ok' :
      state === 'active' ? 'bg-accent text-white border-accent' :
                           'bg-surface border-border text-ink-4'
    }`}>
      {state === 'done' ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        state === 'active' ? <span className="live-dot" style={{color:'#fff',width:6,height:6}} /> : null
      )}
    </div>
  );
}

export default function Checkout({ onTransactionComplete }) {
  const [tourStep, setTourStep] = useState(1);
  const [merchant, setMerchant] = useState(MERCHANTS[0]);
  const [loading, setLoading] = useState(false);
  const [tokenData, setTokenData] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [step, setStep] = useState('idle'); // idle | generated | sim | done
  const [simData, setSimData] = useState(null);
  const [payResult, setPayResult] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const timerRef = useRef(null);

  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [isPaused, setIsPaused] = useState(false);
  const [isEditingLimit, setIsEditingLimit] = useState(false);
  const [editLimitAmount, setEditLimitAmount] = useState('');
  const [showRawToken, setShowRawToken] = useState(false);
  const [customName, setCustomName] = useState('My Store');
  const [customAmount, setCustomAmount] = useState('1000');
  const [customDeviceKnown, setCustomDeviceKnown] = useState(false);
  const [customLocationMatch, setCustomLocationMatch] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [authMode, setAuthMode] = useState('biometric');
  const [bioScanActive, setBioScanActive] = useState(false);
  const [bioScanComplete, setBioScanComplete] = useState(false);
  const typingStartRef = useRef(null);
  const cardRef = useRef(null);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rotateY = -((x - rect.width / 2) / (rect.width / 2)) * 12;
    const rotateX = ((y - rect.height / 2) / (rect.height / 2)) * 12;
    setTilt({ x: rotateX, y: rotateY });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  const handleTogglePause = async () => {
    if (!tokenData) return;
    playSound('click');
    setLoading(true);
    const newStatus = isPaused ? 'active' : 'paused';
    try {
      await updateTokenStatus(tokenData.token, newStatus);
      setIsPaused(!isPaused);
      setTokenData(prev => ({ ...prev, status: newStatus }));
    } catch (err) {
      showToast('Failed to update token status.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLimit = async (e) => {
    e.preventDefault();
    if (!tokenData) return;
    playSound('click');
    const amt = parseFloat(editLimitAmount);
    if (isNaN(amt) || amt <= 0) {
      showToast('Please enter a valid amount.');
      return;
    }
    if (amt > 10_000_000) {
      showToast('Max spend limit is 10,000,000 PKR.');
      return;
    }
    setLoading(true);
    try {
      await updateTokenLimit(tokenData.token, amt);
      setTokenData(prev => ({ ...prev, amount: amt }));
      setIsEditingLimit(false);
    } catch (err) {
      showToast('Failed to update spend limit.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (step === 'generated' && timeLeft > 0 && !isPaused) {
      timerRef.current = setTimeout(() => setTimeLeft(n => n - 1), 1000);
    } else if (step === 'generated' && timeLeft === 0) {
      reset();
    }
    return () => clearTimeout(timerRef.current);
  }, [timeLeft, step, isPaused]);
  useEffect(() => {
    if (step === 'idle' || step === 'sim') {
      typingStartRef.current = Date.now();
    }
  }, [step]);


  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const reset = () => {
    setTokenData(null);
    setSimData(null);
    setPayResult(null);
    setStep('idle');
    setTimeLeft(0);
    setIsPaused(false);
    setIsEditingLimit(false);
    setEditLimitAmount('');
    setShowRawToken(false);
    setTourStep(1);
    clearTimeout(timerRef.current);
  };

  const handleGenerate = async () => {
    playSound('click');
    
    const targetName = merchant.name === 'Custom Merchant' ? customName : merchant.name;
    const targetAmount = merchant.name === 'Custom Merchant' ? Number(customAmount) : merchant.amount;

    if (isNaN(targetAmount) || targetAmount <= 0) {
      showToast('Please enter a valid amount.');
      return;
    }

    if (targetAmount > 10000000) {
      showToast('Amount exceeds maximum limit of 10,000,000 PKR.');
      return;
    }

    setLoading(true);
    try {
      const data = await generateToken(
        targetName,
        targetAmount,
        merchant.currency,
        300
      );
      const masked = `${data.token.slice(0, 4)} **** **** ${data.token.slice(12)}`;
      setTokenData({ ...data, token_masked: masked });
      setEditLimitAmount(String(data.amount));
      setTimeLeft(300);
      setStep('generated');
      localStorage.setItem(`raw_${masked}`, data.token);
    } catch (err) {
      const serverError = err.response?.data?.detail;
      if (serverError) {
        showToast(typeof serverError === 'string' ? serverError : JSON.stringify(serverError));
      } else {
        showToast('Could not reach backend. Make sure uvicorn is running on port 8080.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSendToMerchant = async () => {
    playSound('click');
    setLoading(true);
    try {
      const targetName = merchant.name === 'Custom Merchant' ? customName : merchant.name;
      const targetAmount = merchant.name === 'Custom Merchant' ? Number(customAmount) : merchant.amount;
      const targetDevice = merchant.name === 'Custom Merchant' ? customDeviceKnown : merchant.device_known;
      const targetLocation = merchant.name === 'Custom Merchant' ? customLocationMatch : merchant.location_match;
      const sim = await simulateMerchant(tokenData.token, targetAmount, targetName, {
        device_known: targetDevice,
        location_match: targetLocation,
        past_transactions_with_merchant: merchant.past_transactions,
        merchant_category: merchant.category,
      });
      setSimData(sim);
      setStep('sim');
    } catch {
      showToast('Merchant simulation failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSettle = async () => {
    setLoading(true);
    try {
      const targetName = merchant.name === 'Custom Merchant' ? customName : merchant.name;
      const targetAmount = merchant.name === 'Custom Merchant' ? Number(customAmount) : merchant.amount;
      const targetDevice = merchant.name === 'Custom Merchant' ? customDeviceKnown : merchant.device_known;
      const targetLocation = merchant.name === 'Custom Merchant' ? customLocationMatch : merchant.location_match;
      
      const typingDurationMs = typingStartRef.current ? (Date.now() - typingStartRef.current) : 0;
      typingStartRef.current = null; // reset
      
      const res = await pay(tokenData.token, targetName, targetAmount, {
        device_known: targetDevice,
        location_match: targetLocation,
        past_transactions_with_merchant: merchant.past_transactions,
        merchant_category: merchant.category,
        biometrics: {
          typing_duration_ms: typingDurationMs
        }
      });
      setPayResult(res);
      setStep('done');
      if (res.decision === 'approve') {
        playSound('success');
      } else {
        playSound('error');
      }
      onTransactionComplete?.({
        transaction_id: res.transaction_id,
        token: tokenData.token,
        token_masked: tokenData.token_masked,
        merchant: targetName,
        amount: targetAmount,
        decision: res.decision,
        explanation: res.explanation
      });
    } catch (err) {
      if (err.response && err.response.data && err.response.data.decision) {
        const payload = err.response.data;
        setPayResult(payload);
        setStep('done');
        if (payload.decision === 'approve') {
          playSound('success');
        } else {
          playSound('error');
        }
        onTransactionComplete?.({
          transaction_id: payload.transaction_id,
          token: tokenData.token,
          token_masked: tokenData.token_masked,
          merchant: targetName,
          amount: targetAmount,
          decision: payload.decision,
          explanation: payload.explanation
        });
      } else {
        playSound('error');
        showToast('Payment failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmOTP = async () => {
    if (!otpCode) {
      showToast('Please enter the OTP code.');
      return;
    }
    setOtpLoading(true);
    try {
      const targetName = merchant.name === 'Custom Merchant' ? customName : merchant.name;
      const targetAmount = merchant.name === 'Custom Merchant' ? Number(customAmount) : merchant.amount;
      const res = await confirmPayment(payResult.transaction_id, tokenData.token, otpCode);
      setPayResult(res);
      playSound('success');
      showToast('OTP Verified! Transaction approved.');
      onTransactionComplete?.({
        transaction_id: res.transaction_id,
        token: tokenData.token,
        token_masked: tokenData.token_masked,
        merchant: targetName,
        amount: targetAmount,
        decision: res.decision,
        explanation: res.explanation
      });
    } catch (err) {
      playSound('error');
      const detail = err.response?.data?.detail || 'Invalid OTP code. Please try again.';
      showToast(detail);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleBiometricScan = async () => {
    playSound('click');
    setBioScanActive(true);
    setTimeout(async () => {
      setBioScanActive(false);
      setBioScanComplete(true);
      playSound('success');
      
      setOtpLoading(true);
      try {
        const targetName = merchant.name === 'Custom Merchant' ? customName : merchant.name;
        const targetAmount = merchant.name === 'Custom Merchant' ? Number(customAmount) : merchant.amount;
        const res = await confirmPayment(payResult.transaction_id, tokenData.token, '123456');
        showToast('Biometric assertion verified successfully. Transaction settled!');
        
        setPayResult(res);
        setStep('done');
        onTransactionComplete?.({
          transaction_id: res.transaction_id,
          token: tokenData.token,
          token_masked: tokenData.token_masked,
          merchant: targetName,
          amount: targetAmount,
          decision: 'approve',
          explanation: 'Approved: 3DS2 biometric challenge verified via local WebAuthn (FIDO2) simulator.'
        });
      } catch (err) {
        showToast('Biometric assertion failed or expired.');
      } finally {
        setOtpLoading(false);
        setBioScanComplete(false);
      }
    }, 2000);
  };

  const stepState = (s) => {
    const order = ['generated', 'sim', 'done'];
    const current = order.indexOf(step);
    const target = order.indexOf(s);
    if (step === 'idle') return 'idle';
    if (step === 'done') return 'done';
    if (current > target) return 'done';
    if (current === target) return 'active';
    return 'idle';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* 🚀 Guided Hackathon Tour Card */}
      <div className="card p-6 border-l-4 border-l-accent relative overflow-hidden bg-surface-2 shadow-lg">
        {/* Gradients */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="badge badge-accent uppercase tracking-wider text-4xs font-extrabold animate-pulse">💡 Tour Mode Active</span>
              <h2 className="text-base font-bold text-ink">SecurePay AI Sandbox Playground</h2>
            </div>
            <p className="text-2xs text-ink-3 mt-1">
              Follow this step-by-step interactive sandbox to evaluate the product. Running in real-time on AMD MI300X accelerators.
            </p>
          </div>
          
          {/* Steps Navigator */}
          <div className="flex items-center gap-1.5 bg-surface border border-border rounded-lg p-1.5 self-start md:self-auto">
            {[1, 2, 3, 4, 5].map(i => (
              <button
                key={i}
                onClick={() => setTourStep(i)}
                className={`w-6 h-6 rounded-md text-2xs font-bold transition-all ${
                  tourStep === i 
                    ? 'bg-accent text-white shadow-sm' 
                    : 'text-ink-3 hover:bg-surface-2'
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>

        {/* Step details content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-8 space-y-1.5">
            <span className="text-3xs uppercase font-extrabold text-accent tracking-widest font-mono">
              STEP {tourStep} of 5: {
                tourStep === 1 ? "Select Preset Scenario" :
                tourStep === 2 ? "Issue Disposable Payment Token" :
                tourStep === 3 ? "Process Merchant Checkout" :
                tourStep === 4 ? "AMD Instinct™ Accelerated AI Risk Analysis" :
                "Revoke Token Access (Kill Switch)"
              }
            </span>
            <p className="text-xs text-ink-2 leading-relaxed font-sans">
              {
                tourStep === 1 ? "Start by setting up the scenario. We have pre-configured Netflix (low-risk subscription) and CryptoBazaar (high-risk untrusted merchant) to demonstrate the AI engine's behavior. Click the button below to auto-select Netflix." :
                tourStep === 2 ? "We will generate a mock payment card. Under the hood, this token is cryptographically locked to Netflix and capped at a maximum spend of 1,200 PKR. If hackers steal this token, it cannot be used elsewhere!" :
                tourStep === 3 ? "Now we simulate entering this token on Netflix's payment form. Under the 'Merchant terminal view' on the right, observe that the merchant ONLY receives the disposable token. The real card details are completely protected!" :
                tourStep === 4 ? "We execute the AI fraud engine. Running on AMD Instinct MI300X hardware via Fireworks AI, the Google Gemma 3 27B model evaluates location mismatches, unrecognized devices, and transaction velocities in real-time, outputting plain-language Explainable AI reasons." :
                "Your payment was evaluated! Now switch to the 'Risk Dashboard' tab to trigger a mock data breach, or use the 'Kill Switch' under Active Subscriptions to instantly block Netflix from making future charges."
              }
            </p>
          </div>

          <div className="lg:col-span-4 flex justify-end">
            {tourStep === 1 && (
              <button
                onClick={() => {
                  playSound('click');
                  const found = MERCHANTS.find(m => m.name === 'Netflix');
                  if (found) setMerchant(found);
                  setTourStep(2);
                }}
                className="btn-primary w-full lg:w-auto text-xs py-2 px-4 shadow-[0_0_15px_rgba(193,95,60,0.2)]"
              >
                Auto-Select Netflix Scenario ➔
              </button>
            )}

            {tourStep === 2 && (
              <button
                onClick={async () => {
                  setTourStep(3);
                  await handleGenerate();
                }}
                disabled={loading}
                className="btn-primary bg-accent hover:bg-accent/90 text-white w-full lg:w-auto text-xs py-2 px-4 flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(193,95,60,0.3)]"
              >
                {loading ? <span className="spinner" /> : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 9h7.5L9 20.25 10.5 13.5H3.75z" />
                    </svg>
                    Generate Token ⚡
                  </>
                )}
              </button>
            )}

            {tourStep === 3 && (
              <button
                onClick={async () => {
                  setTourStep(4);
                  await handleSendToMerchant();
                }}
                disabled={loading}
                className="btn-primary bg-accent hover:bg-accent/90 text-white w-full lg:w-auto text-xs py-2 px-4 flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(193,95,60,0.3)]"
              >
                {loading ? <span className="spinner" /> : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                    Send to Checkout ➔
                  </>
                )}
              </button>
            )}

            {tourStep === 4 && (
              <button
                onClick={async () => {
                  setTourStep(5);
                  await handleSettle();
                }}
                disabled={loading}
                className="btn-primary bg-accent hover:bg-accent/90 text-white w-full lg:w-auto text-xs py-2 px-4 flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(193,95,60,0.3)]"
              >
                {loading ? <span className="spinner" /> : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                    Run AI Risk Analysis 🧠
                  </>
                )}
              </button>
            )}

            {tourStep === 5 && (
              <div className="flex gap-2 w-full lg:w-auto">
                <button
                  onClick={() => {
                    playSound('click');
                    window.location.hash = '#/dashboard';
                    reset();
                    setTourStep(1);
                  }}
                  className="btn-primary w-full lg:w-auto text-xs py-2 px-4 shadow-[0_0_15px_rgba(193,95,60,0.2)]"
                >
                  Go to Dashboard 🛡️
                </button>
                <button
                  onClick={() => {
                    playSound('click');
                    reset();
                    setTourStep(1);
                  }}
                  className="btn-secondary w-full lg:w-auto text-xs py-2 px-4"
                >
                  Restart Tour 🔄
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">

      {/* LEFT - Scenario picker */}
      <div className="lg:col-span-2 space-y-4">
        <div className="card p-5">
          <div className="mb-4">
            <p className="eyebrow mb-1">Test scenario</p>
            <h2 className="text-base font-semibold text-ink">Select a transaction</h2>
          </div>

          {/* Dropdown Selector */}
          <div className="mb-4">
            <label className="block text-2xs font-semibold text-ink-3 uppercase tracking-wider mb-1.5">Select Preset Merchant</label>
            <select
              value={merchant.name}
              onChange={(e) => {
                const found = MERCHANTS.find(m => m.name === e.target.value);
                if (found) setMerchant(found);
              }}
              disabled={step !== 'idle'}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-xs text-ink focus:outline-none focus:border-accent cursor-pointer"
            >
              {MERCHANTS.map(m => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Scenario Details Preview Card */}
          <div className="border border-border rounded-card bg-surface-2 p-4 mb-4">
            <div className="flex justify-between items-start mb-2.5">
              <span className="text-xs font-semibold text-accent">{merchant.name}</span>
              {merchant.name !== 'Custom Merchant' ? (
                <span className="text-xs font-mono font-semibold text-ink-2">{merchant.amount.toLocaleString()} PKR</span>
              ) : (
                <span className="text-xs font-mono font-semibold text-ink-2">{Number(customAmount).toLocaleString()} PKR</span>
              )}
            </div>
            <p className="text-2xs text-ink-3 mb-3 leading-relaxed">
              {merchant.name === 'Custom Merchant' ? 'Test custom store names and amounts. Great for simulating custom transaction setups.' : merchant.desc}
            </p>
            
            {merchant.name !== 'Custom Merchant' && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-border">
                <span className={EXPECTED_LABELS[merchant.expected].cls}>{EXPECTED_LABELS[merchant.expected].label}</span>
                <div className="flex items-center gap-2.5 text-3xs font-mono text-ink-4">
                  <span>{merchant.device_known ? 'Device known' : 'Unknown device'}</span>
                  <span>●</span>
                  <span>{merchant.location_match ? 'Location matched' : 'Location mismatch'}</span>
                </div>
              </div>
            )}
          </div>

          {merchant.name === 'Custom Merchant' && step === 'idle' && (
            <div className="mb-4 p-4 border border-accent rounded-card bg-accent-muted space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-3 mb-1 uppercase">Store Name</label>
                <input 
                  type="text" 
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-3 mb-1 uppercase">Amount (PKR)</label>
                <input 
                  type="number" 
                  value={customAmount}
                  onChange={e => setCustomAmount(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-4 pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-ink-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border text-accent focus:ring-accent cursor-pointer"
                    checked={customDeviceKnown}
                    onChange={(e) => setCustomDeviceKnown(e.target.checked)}
                  />
                  Device Known
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-ink-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border text-accent focus:ring-accent cursor-pointer"
                    checked={customLocationMatch}
                    onChange={(e) => setCustomLocationMatch(e.target.checked)}
                  />
                  Location Matched
                </label>
              </div>
            </div>
          )}

          {step === 'idle' ? (
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? <span className="spinner" /> : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
              )}
              {loading ? 'Generating...' : 'Generate secure token'}
            </button>
          ) : (
            <button onClick={reset} className="btn-secondary w-full">
              Start over
            </button>
          )}
        </div>

        {/* Info card */}
        <div className="card p-4 bg-accent-muted border-accent-border">
          <div className="flex gap-3">
            <div className="shrink-0 mt-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-accent mb-1">How this works</p>
              <p className="text-xs text-ink-2 leading-relaxed">
                SecurePay AI issues a disposable token instead of your real card number. The token is merchant-locked and amount-capped. If the merchant is breached, attackers get nothing useful.
              </p>
            </div>
          </div>
        </div>
      </div>
      {/* RIGHT - Flow workspace */}
      <div className="lg:col-span-3 space-y-4">

        {/* Progress steps */}
        {step !== 'idle' && (
          <div className="card p-5">
            <div className="flex items-center gap-0">
              {[
                { key: 'generated', label: 'Token generated' },
                { key: 'sim', label: 'Merchant verified' },
                { key: 'done', label: 'AI decision' },
              ].map((s, i) => (
                <React.Fragment key={s.key}>
                  <div className="flex items-center gap-2 flex-1">
                    <StepDot state={stepState(s.key)} />
                    <span className={`text-xs font-medium hidden sm:block ${
                      stepState(s.key) === 'idle' ? 'text-ink-4' : 'text-ink'
                    }`}>{s.label}</span>
                  </div>
                  {i < 2 && (
                    <div className={`h-px flex-1 max-w-8 transition-colors ${
                      stepState(s.key) === 'done' ? 'bg-ok' : 'bg-border'
                    }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Token card */}
        {tokenData && (
          <div className="card p-5 row-in">
            <div className="flex items-center justify-between mb-4">
              <p className="eyebrow">Disposable token</p>
              <span className={isPaused ? "badge badge-bad" : "badge badge-ok"}>
                <span className="live-dot" style={{color: isPaused ? '#b91c1c' : '#059669', width:6, height:6}} />
                {isPaused ? 'Paused' : 'Active'}
              </span>
            </div>

            {/* Card visual */}
            <div
              ref={cardRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              className="bg-accent rounded-card p-5 mb-4 relative overflow-hidden select-none cursor-pointer"
              style={{
                transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                transition: tilt.x === 0 && tilt.y === 0 ? 'transform 0.5s ease' : 'none',
                transformStyle: 'preserve-3d',
                boxShadow: '0 20px 25px -5px rgba(27, 26, 23, 0.1), 0 10px 10px -5px rgba(27, 26, 23, 0.04)'
              }}
            >
              <div className="absolute right-0 top-0 w-40 h-40 rounded-full bg-white/5 -translate-y-12 translate-x-12" />
              <div className="flex justify-between items-start mb-8" style={{ transform: 'translateZ(30px)' }}>
                {/* Chip */}
                <div className="w-9 h-6 rounded bg-yellow-400/80 flex flex-col justify-around px-1 py-0.5 gap-0.5">
                  <div className="h-px bg-yellow-600/60" />
                  <div className="h-px bg-yellow-600/60" />
                  <div className="h-px bg-yellow-600/60" />
                </div>
                <div className="text-2xs font-mono text-ink-4 uppercase tracking-widest">SecurePay AI</div>
              </div>

              <div className="flex items-center justify-between font-mono text-xl text-white tracking-widest mb-5" style={{ transform: 'translateZ(40px)' }}>
                <span>
                  <ScrambleText text={showRawToken ? tokenData.token.match(/.{1,4}/g).join(' ') : tokenData.token_masked} />
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRawToken(!showRawToken);
                      playSound('click');
                    }}
                    className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                    title={showRawToken ? "Hide card number" : "Show card number"}
                  >
                    {showRawToken ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L21 21m-9-9a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(tokenData.token);
                      playSound('click');
                      showToast('Token card number copied to clipboard!');
                    }}
                    className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                    title="Copy card number"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Token CVV & Expiry visual row */}
              <div className="flex justify-between items-center text-xs font-mono text-white/95 mb-6 pl-1" style={{ transform: 'translateZ(35px)' }}>
                <div className="flex gap-6">
                  <div>
                    <span className="text-3xs text-white/50 block uppercase leading-none mb-1 font-sans">Expiry</span>
                    <span className="font-semibold tracking-wider">{tokenData.token_expiry || "12/28"}</span>
                  </div>
                  <div>
                    <span className="text-3xs text-white/50 block uppercase leading-none mb-1 font-sans">CVV</span>
                    <span className="font-semibold tracking-wider">{tokenData.token_cvv || "782"}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-3xs text-white/50 block uppercase leading-none mb-1 font-sans">Cardholder</span>
                  <span className="font-medium tracking-wide text-3xs">SecurePay User</span>
                </div>
              </div>
              <div className="flex justify-between text-2xs font-mono text-ink-4" style={{ transform: 'translateZ(30px)' }}>
                <div>
                  <div className="text-ink-5 mb-0.5">MERCHANT LOCK</div>
                  <div className="text-white font-medium">{tokenData.merchant}</div>
                </div>
                <div className="text-right">
                  <div className="text-ink-5 mb-0.5">SPEND CAP</div>
                  <div className="text-white font-medium">{tokenData.amount} {tokenData.currency}</div>
                </div>
                <div className="text-right">
                  <div className="text-ink-5 mb-0.5">EXPIRES IN</div>
                  <div className={`font-medium ${timeLeft < 60 ? 'text-bad' : 'text-white'}`}>
                    {fmt(timeLeft)}
                  </div>
                </div>
              </div>
            </div>

            {/* Auto-destruction progress countdown bar */}
            <div className="mb-4">
              <div className="flex justify-between text-2xs text-ink-3 mb-1">
                <span>Token Life Progress</span>
                <span>{Math.round((timeLeft / (tokenData.ttl_seconds || 300)) * 100)}%</span>
              </div>
              <div className="w-full bg-surface-3 h-1.5 rounded-full overflow-hidden border border-ink-5">
                <div
                  className="bg-accent h-full transition-all duration-1000"
                  style={{ width: `${(timeLeft / (tokenData.ttl_seconds || 300)) * 100}%` }}
                />
              </div>
            </div>

            {/* Token details */}
            <div className="space-y-0">
              <div className="data-row text-sm">
                <span className="text-ink-3">Token ID</span>
                <span className="font-mono text-xs text-ink">{tokenData.token_masked}</span>
              </div>
              <div className="data-row text-sm">
                <span className="text-ink-3">Real card shared with merchant</span>
                <span className="font-medium text-ok">No</span>
              </div>
            </div>

            {/* Controls panel */}
            <div className="border-t border-ink-5 pt-3 mt-3 flex items-center justify-between gap-4">
              <button
                onClick={handleTogglePause}
                disabled={loading}
                className="btn-secondary py-1.5 px-3 text-xs"
              >
                {isPaused ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                    </svg>
                    Resume
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                    </svg>
                    Pause
                  </>
                )}
              </button>

              {isEditingLimit ? (
                <form onSubmit={handleUpdateLimit} className="flex items-center gap-2">
                  <input
                    type="number"
                    value={editLimitAmount}
                    onChange={(e) => setEditLimitAmount(e.target.value)}
                    className="border border-ink-4 bg-surface rounded px-2 py-1 text-xs w-24 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  />
                  <button type="submit" disabled={loading} className="btn-primary py-1 px-2.5 text-2xs">Save</button>
                  <button type="button" onClick={() => setIsEditingLimit(false)} className="btn-secondary py-1 px-2.5 text-2xs">Cancel</button>
                </form>
              ) : (
                <button
                  onClick={() => setIsEditingLimit(true)}
                  disabled={loading}
                  className="btn-secondary py-1.5 px-3 text-xs"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.83 20.013a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                  </svg>
                  Edit Limit
                </button>
              )}
            </div>

            {step === 'generated' && (
              <button
                onClick={handleSendToMerchant}
                disabled={loading}
                className="btn-secondary w-full mt-4"
              >
                {loading ? <span className="spinner" /> : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                )}
                Send to {merchant.name} checkout
              </button>
            )}
          </div>
        )}

        {/* Merchant terminal view */}
        {step === 'sim' && simData && (
          <div className="card p-5 row-in">
            <div className="flex items-center gap-2 mb-4">
              <p className="eyebrow">Merchant terminal view</p>
              <span className="badge badge-neutral ml-auto">What the merchant sees</span>
            </div>

            {/* Security callout */}
            <div className="flex items-start gap-3 p-3 bg-ok-muted border border-ok-border rounded-lg mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-ok shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <div>
                <p className="text-xs font-semibold text-ok">Zero card data leaked</p>
                <p className="text-2xs text-ink-2 mt-0.5">The merchant's server only received a disposable token. Even if they are breached tomorrow, your real card number is <strong>never exposed</strong>.</p>
              </div>
            </div>

            <div className="bg-surface-2 border border-border rounded-card overflow-hidden mb-4">
              <div className="px-4 py-2.5 border-b border-border bg-surface-3 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-bad/40" />
                  <div className="w-3 h-3 rounded-full bg-warn/40" />
                  <div className="w-3 h-3 rounded-full bg-ok/40" />
                </div>
                <span className="text-2xs font-mono text-ink-3">{merchant.name} payment-api/checkout</span>
              </div>
              <div className="p-4 font-mono text-xs space-y-2.5 text-ink-2">
                <div className="flex justify-between">
                  <span className="text-ink-3">token_received</span>
                  <span className="font-semibold">{simData.received_token}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">card_number</span>
                  <span className="text-ink-4 italic">null</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">cardholder_name</span>
                  <span className="text-ink-4 italic">null</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">cvv</span>
                  <span className="text-ink-4 italic">null</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2.5">
                  <span className="text-ink-3">breach_value</span>
                  <span className="text-ok font-semibold">$0 (token is worthless to attacker)</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleSettle}
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? <span className="spinner" /> : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              )}
              Run AI Risk Analysis on AMD Hardware
            </button>
          </div>
        )}

        {/* AI decision result */}
        {step === 'done' && payResult && (
          <div className={`card p-5 row-in border-l-4 ${
            payResult.decision === 'approve' ? 'border-l-ok' :
            payResult.decision === 'step_up' ? 'border-l-warn' :
            'border-l-bad'
          }`}>
            <div className="flex items-start gap-4 mb-4">
              <div className={`w-10 h-10 rounded-card flex items-center justify-center shrink-0 ${
                payResult.decision === 'approve' ? 'bg-ok-muted text-ok' :
                payResult.decision === 'step_up' ? 'bg-warn-muted text-warn' :
                'bg-bad-muted text-bad'
              }`}>
                {payResult.decision === 'approve' && (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
                {payResult.decision === 'step_up' && (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                )}
                {payResult.decision === 'decline' && (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-base font-semibold text-ink">
                    {payResult.decision === 'approve' ? 'Payment approved' :
                     payResult.decision === 'step_up' ? 'Verification required' :
                     'Payment declined'}
                  </h3>
                  {payResult.risk_score !== null && (
                    <span className={`badge text-2xs ${
                      payResult.risk_score < 30 ? 'badge-ok' :
                      payResult.risk_score < 70 ? 'badge-warn' : 'badge-bad'
                    }`}>
                      Risk <AnimatedNumber value={payResult.risk_score} />/100
                    </span>
                  )}
                </div>
                <p className="text-2xs font-mono text-ink-3">{payResult.transaction_id}</p>
              </div>
            </div>

            {/* Risk score bar */}
            {payResult.risk_score !== null && (
              <div className="mb-4">
                <div className="flex justify-between text-2xs text-ink-3 mb-1.5">
                  <span>AI risk score</span>
                  <span className="font-mono font-medium"><AnimatedNumber value={payResult.risk_score} /> / 100</span>
                </div>
                <div className="progress-bar">
                  <div
                    className={`h-full rounded-pill transition-all duration-500 ${
                      payResult.risk_score < 30 ? 'bg-ok' :
                      payResult.risk_score < 70 ? 'bg-warn' : 'bg-bad'
                    }`}
                    style={{ width: `${payResult.risk_score}%` }}
                  />
                </div>
              </div>
            )}

            {/* AI explanation */}
            <div className="bg-surface-2 border border-border rounded-card p-4 mb-4">
              <p className="text-2xs font-semibold text-ink-3 uppercase tracking-widest mb-2">
                AI Risk Explanation
              </p>
              <p className="text-sm text-ink-2 leading-relaxed">{payResult.explanation}</p>
            </div>

            {/* Next Step CTA */}
            {payResult.decision === 'step_up' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 bg-warn-muted border border-warn-border rounded-card">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-warn shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-warn">Verification Required</p>
                    <p className="text-2xs text-ink-2 mt-0.5">The AI flagged this transaction. You can authenticate instantly via 3DS2 OTP below, or open the Agent Workspace to negotiate with the AI analyst.</p>
                  </div>
                  <button
                    onClick={() => { window.location.hash = '#/agent'; }}
                    className="btn-primary py-2 px-4 text-xs shrink-0"
                  >
                    Open Agent Workspace →
                  </button>
                </div>

                <div className="p-5 border border-border bg-surface-2 rounded-card animate-in fade-in duration-300">
                  {/* Tabs */}
                  <div className="flex border-b border-border mb-4">
                    <button
                      onClick={() => setAuthMode('biometric')}
                      className={`pb-2 px-4 text-xs font-bold transition-colors ${authMode === 'biometric' ? 'text-accent border-b-2 border-accent' : 'text-ink-3 hover:text-ink'}`}
                    >
                      Instant Biometric Scan (WebAuthn)
                    </button>
                    <button
                      onClick={() => setAuthMode('otp')}
                      className={`pb-2 px-4 text-xs font-bold transition-colors ${authMode === 'otp' ? 'text-accent border-b-2 border-accent' : 'text-ink-3 hover:text-ink'}`}
                    >
                      SMS One-Time Passcode (OTP)
                    </button>
                  </div>

                  {authMode === 'biometric' ? (
                    <div className="flex flex-col items-center py-4 text-center">
                      {!bioScanActive && !bioScanComplete ? (
                        <>
                          <div className="w-16 h-16 rounded-full bg-accent-muted border border-accent flex items-center justify-center mb-3 scanning-active cursor-pointer" onClick={handleBiometricScan}>
                            <svg className="w-8 h-8 text-accent animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0-3.517-1.009-6.799-2.753-9.571m-3.44 2.04l.054-.09A13.916 13.916 0 009 11a5 5 0 0010 0c0-1.02-.139-2.007-.4-2.936m-5.6 3.685A3 3 0 0015 11c0-1.657-1.343-3-3-3s-3 1.343-3 3a10.025 10.025 0 004.132 8.163m9.68-2.903A9.973 9.973 0 0119.5 19.5m-15-7a9.973 9.973 0 011.243-4.82m12.72-2.12a9.96 9.96 0 00-3.463-1.065" />
                            </svg>
                          </div>
                          <p className="text-xs font-semibold text-ink mb-1">Instant WebAuthn Biometric Scan</p>
                          <p className="text-2xs text-ink-2 mb-4 max-w-xs">Simulate TouchID or FaceID verification to instantly authorize this transaction.</p>
                          <button
                            onClick={handleBiometricScan}
                            className="btn-primary py-1.5 px-5 text-xs font-semibold"
                          >
                            Authenticate via Biometrics
                          </button>
                        </>
                      ) : bioScanActive ? (
                        <>
                          <div className="relative w-20 h-20 mb-4 flex items-center justify-center">
                            <div className="absolute inset-0 rounded-full border-4 border-accent border-t-transparent animate-spin" />
                            <span className="text-3xl animate-bounce">🔍</span>
                          </div>
                          <p className="text-xs font-bold text-accent animate-pulse">Scanning biometric credentials...</p>
                          <p className="text-2xs text-ink-3 mt-1">Generating mock FIDO2/WebAuthn public key assertion...</p>
                        </>
                      ) : (
                        <>
                          <div className="w-16 h-16 rounded-full bg-ok-muted border border-ok flex items-center justify-center mb-3 scale-110 transition-transform duration-300">
                            <span className="text-2xl">✅</span>
                          </div>
                          <p className="text-xs font-bold text-ok mb-1">Biometric Verification Successful</p>
                          <p className="text-2xs text-ink-2">Settling transaction with KMS KEK rewrap assertions...</p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-ok">🔐</span>
                        <p className="text-xs font-semibold text-ink">3D Secure 2.0 (3DS2) Verification</p>
                      </div>
                      <p className="text-2xs text-ink-2 mb-3">
                        Enter the 6-digit OTP code sent to your registered mobile phone +92 *** **** 345 (Use code <strong className="font-bold text-ink">123456</strong>):
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="123456"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          className="input-field text-center font-mono text-sm max-w-[120px] py-1.5 px-3"
                          maxLength={6}
                        />
                        <button
                          onClick={handleConfirmOTP}
                          disabled={otpLoading}
                          className="btn-primary py-1.5 px-4 text-xs font-semibold"
                        >
                          {otpLoading ? <span className="spinner" /> : 'Confirm OTP'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {payResult.decision === 'decline' && (
              <div className="flex items-start gap-3 p-4 bg-warn-muted border border-warn-border rounded-card">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-warn shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-warn">Transaction Declined</p>
                  <p className="text-2xs text-ink-2 mt-0.5">The AI engine declined this transaction. Open the Agent Workspace to chat with the AI analyst and request an override policy.</p>
                </div>
                <button
                  onClick={() => { window.location.hash = '#/agent'; }}
                  className="btn-primary py-2 px-4 text-xs shrink-0"
                >
                  Open Agent Workspace →
                </button>
              </div>
            )}

            {payResult.decision === 'approve' && (
              <div className="flex items-center gap-3 p-4 bg-ok-muted border border-ok-border rounded-card">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-ok shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-ok">Transaction authorized by AI</p>
                  <p className="text-2xs text-ink-2 mt-0.5">View the live Risk Dashboard to see token activity logs and system telemetry.</p>
                </div>
                <button
                  onClick={() => { window.location.hash = '#/dashboard'; }}
                  className="btn-secondary py-2 px-4 text-xs shrink-0"
                >
                  View Dashboard →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {step === 'idle' && (
          <div className="card p-8 flex flex-col gap-6">
            <div className="flex flex-col items-center justify-center text-center mb-2">
              <div className="w-14 h-14 rounded-full bg-surface-3 flex items-center justify-center mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
              </div>
              <p className="text-base font-semibold text-ink">Payment Flow Guide</p>
              <p className="text-xs text-ink-3">Follow these steps to see SecurePay AI in action</p>
            </div>
            
            <div className="space-y-4">
              <div className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded bg-accent/20 text-accent flex items-center justify-center text-xs font-bold shrink-0">1</div>
                <div>
                  <p className="text-sm font-medium text-ink">Select a Merchant Scenario</p>
                  <p className="text-xs text-ink-3">Choose a preset from the left panel (e.g., Netflix for approval, CryptoBazaar for decline).</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded bg-accent/20 text-accent flex items-center justify-center text-xs font-bold shrink-0">2</div>
                <div>
                  <p className="text-sm font-medium text-ink">Generate Secure Token</p>
                  <p className="text-xs text-ink-3">Creates a disposable, merchant-locked virtual card.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded bg-accent/20 text-accent flex items-center justify-center text-xs font-bold shrink-0">3</div>
                <div>
                  <p className="text-sm font-medium text-ink">Send to Checkout</p>
                  <p className="text-xs text-ink-3">See what the merchant actually receives (no real card data!).</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded bg-accent/20 text-accent flex items-center justify-center text-xs font-bold shrink-0">4</div>
                <div>
                  <p className="text-sm font-medium text-ink">Run AI Risk Analysis</p>
                  <p className="text-xs text-ink-3">Our AI evaluates the transaction context and provides a plain-language decision.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink-2 text-white px-6 py-3 rounded-card text-sm font-medium shadow-xl z-50 animate-in fade-in slide-in-from-bottom-4">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
