import React, { useState } from 'react';
import { setupWallet } from './api';

export default function WalletSetup({ onComplete }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    pan: '',
    expiry: '',
    cvv: '',
    cardholder: ''
  });

  const handleChange = (e) => {
    let { name, value } = e.target;
    if (name === 'pan') {
      value = value.replace(/\D/g, '').substring(0, 16);
      value = value.replace(/(.{4})/g, '$1 ').trim();
    }
    if (name === 'expiry') {
      value = value.replace(/\D/g, '').substring(0, 4);
      if (value.length > 2) {
        value = `${value.substring(0, 2)}/${value.substring(2)}`;
      }
    }
    if (name === 'cvv') {
      value = value.replace(/\D/g, '').substring(0, 4);
    }
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const rawPan = formData.pan.replace(/\s/g, '');
      await setupWallet(rawPan, formData.expiry, formData.cvv, formData.cardholder);
      onComplete();
    } catch (err) {
      console.error(err);
      const errMsg = err.response?.data?.message || 'Failed to securely vault card. Ensure Luhn checksum and MM/YY expiry are valid.';
      setError(errMsg);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#111] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] right-[-10%] w-[400px] h-[400px] bg-ok/10 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="w-full max-w-lg bg-white/5 border border-white/10 p-8 rounded-2xl backdrop-blur-md relative z-10 shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-2">Vault Your Real Card</h2>
        <p className="text-sm text-ink-3 mb-6">
          Your card is AES-256 encrypted directly on the server. We will never share these details with merchants. 
          You will issue disposable tokens instead.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-bad/20 border border-bad/30 rounded-lg text-xs text-bad">
            <p className="font-semibold mb-1">Vault Error</p>
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-3 mb-1 uppercase">Cardholder Name</label>
            <input 
              type="text" 
              name="cardholder"
              required
              value={formData.cardholder}
              onChange={handleChange}
              placeholder="e.g. John Doe"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-3 mb-1 uppercase">16-Digit Card Number</label>
            <div className="relative">
              <input 
                type="text" 
                name="pan"
                required
                value={formData.pan}
                onChange={handleChange}
                placeholder="4242 4242 4242 4242"
                className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 font-mono text-white tracking-widest focus:outline-none focus:border-accent transition-colors"
              />
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-3.5 w-4 h-4 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <p className="text-[10px] text-ink-4 mt-1">Must be Luhn-valid (e.g. use standard 4242 4242 4242 4242 for testing).</p>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-ink-3 mb-1 uppercase">Expiry</label>
              <input 
                type="text" 
                name="expiry"
                required
                value={formData.expiry}
                onChange={handleChange}
                placeholder="MM/YY"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 font-mono text-white focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-ink-3 mb-1 uppercase">CVV</label>
              <input 
                type="password" 
                name="cvv"
                required
                value={formData.cvv}
                onChange={handleChange}
                placeholder="123"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 font-mono text-white focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading || formData.pan.length < 19}
            className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-lg transition-all duration-200 disabled:opacity-50 mt-6 flex justify-center items-center gap-2"
          >
            {loading ? (
               <span className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Securely Vault Card
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
