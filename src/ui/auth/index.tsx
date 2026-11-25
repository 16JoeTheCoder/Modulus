import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  KeyRound,
  LogOut,
  Mail,
  Shield,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';
import type { IAuthUser, IGarageSyncResponse } from '../../core/types';

export interface IAuthModalProps {
  engine: ModulusEngine;
  storage: StorageSync;
}

type AuthStep = 'email' | 'otp';

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
}

export function AuthModal({ engine, storage }: IAuthModalProps) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<IAuthUser | null>(() => storage.getUser());
  const [credits, setCredits] = useState<number>(() => storage.getCredits());
  const [ownedCount, setOwnedCount] = useState<number>(
    () => storage.getGarageState().ownedPartIds.length
  );

  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const unsubOpen = engine.events.on('auth:open-modal', () => {
      setUser(storage.getUser());
      setCredits(storage.getCredits());
      setOwnedCount(storage.getGarageState().ownedPartIds.length);
      setError(null);
      setInfo(null);
      setOpen(true);
    });

    const unsubAuth = engine.events.on('auth:changed', ({ user: nextUser }) => {
      setUser(nextUser);
    });

    const unsubEcon = engine.events.on('economy:updated', ({ credits: c, ownedPartIds }) => {
      setCredits(c);
      setOwnedCount(ownedPartIds.length);
    });

    return () => {
      unsubOpen();
      unsubAuth();
      unsubEcon();
    };
  }, [engine, storage]);

  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || googleClientId) return;
    fetch('/api/auth/config', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { googleClientId?: string | null } | null) => {
        if (d?.googleClientId) setGoogleClientId(d.googleClientId);
      })
      .catch(() => undefined);
  }, [open, googleClientId]);

  useEffect(() => {
    if (!open || user || step !== 'email' || !googleClientId) return;
    let cancelled = false;
    const render = () => {
      const g = (window as unknown as { google?: GoogleIdentity }).google;
      if (cancelled || !g || !googleBtnRef.current) return;
      g.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp) => void handleGoogleCredential(resp.credential),
      });
      g.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 320,
      });
    };
    if ((window as unknown as { google?: GoogleIdentity }).google) {
      render();
    } else {
      const existing = document.getElementById('gsi-client') as HTMLScriptElement | null;
      const script = existing ?? document.createElement('script');
      if (!existing) {
        script.id = 'gsi-client';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, step, googleClientId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  const handleGoogleCredential = async (credential: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credential }),
      });
      const data = (await res.json().catch(() => ({}))) as IGarageSyncResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Google sign-in failed (${res.status})`);
      storage.reconcileCloudGarage(data);
      engine.updateBuild(storage.getGarageState().activeBuild);
      setUser(data.user);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setDevOtpCode(null);

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        devOtpCode?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      setEmail(trimmed);
      setStep('otp');
      setOtpCode('');
      if (data.devOtpCode) {
        setDevOtpCode(data.devOtpCode);
      }
      setInfo(`6-digit code dispatched to ${trimmed}. Valid for 10 minutes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const cleaned = otpCode.replace(/\D/g, '').slice(0, 6);
    if (cleaned.length !== 6) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: cleaned }),
      });
      const data = (await res.json().catch(() => ({}))) as IGarageSyncResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `Verification failed (${res.status})`);
      }

      storage.reconcileCloudGarage(data);
      engine.updateBuild(storage.getGarageState().activeBuild);
      setUser(data.user);
      setStep('email');
      setOtpCode('');
      setDevOtpCode(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    setError(null);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      storage.setUser(null);
      setUser(null);
      setStep('email');
      setOtpCode('');
      setDevOtpCode(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdmin = () => {
    window.history.pushState({}, '', '/admin');
    window.dispatchEvent(new PopStateEvent('popstate'));
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 select-text"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-[#12161F] border border-[#1E2532] shadow-2xl shadow-black/70 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2532] bg-[#0A0C10]/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00F0FF]/10 border border-[#00F0FF]/30 flex items-center justify-center text-[#00F0FF]">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wider uppercase text-slate-100">
                {user ? 'Telemetry Cloud Sync' : 'Cloud Garage Sign-In'}
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                30-Day Passwordless Email OTP
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {user ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-[#0A0C10] border border-[#1E2532] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-wider text-slate-400">
                    Signed-In Driver
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      user.role === 'admin'
                        ? 'bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/30'
                        : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    {user.role === 'admin' ? 'Admin' : 'Synced 30d'}
                  </span>
                </div>
                <div className="font-mono text-sm text-slate-100 break-all">{user.email}</div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#1E2532]">
                  <div className="rounded-lg bg-[#12161F] border border-[#1E2532] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Synced Credits
                    </div>
                    <div className="text-lg font-mono font-bold text-[#00F0FF] mt-0.5">
                      {credits.toLocaleString()} <span className="text-xs text-slate-400">CR</span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#12161F] border border-[#1E2532] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Owned Parts
                    </div>
                    <div className="text-lg font-mono font-bold text-slate-100 mt-0.5 flex items-center gap-1.5">
                      <Wrench className="w-4 h-4 text-[#F59E0B]" />
                      {user.unlockAll ? 'ALL' : ownedCount}
                    </div>
                  </div>
                </div>
              </div>

              {user.role === 'admin' && (
                <button
                  type="button"
                  onClick={handleOpenAdmin}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 border border-[#00F0FF]/40 text-[#00F0FF] font-semibold text-sm transition-colors"
                >
                  <Shield className="w-4 h-4" />
                  Open Mission Control (/admin)
                </button>
              )}

              {error && (
                <div className="rounded-lg bg-[#FF3B30]/10 border border-[#FF3B30]/30 px-3 py-2 text-xs text-[#FF3B30]">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleLogout}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0A0C10] hover:bg-slate-800/80 border border-[#1E2532] text-slate-300 font-medium text-sm transition-colors disabled:opacity-50"
              >
                <LogOut className="w-4 h-4" />
                {loading ? 'Signing Out...' : 'Sign Out'}
              </button>
            </div>
          ) : step === 'email' ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                Enter your email to receive a 6-digit sign-in code. Your builds, parts inventory,
                and leaderboard laps stay synced across devices for 30 days.
              </p>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="driver@modulus.josefyang.com"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#0A0C10] border border-[#1E2532] focus:border-[#00F0FF] focus:outline-none text-sm text-slate-100 placeholder:text-slate-600 font-mono"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-[#FF3B30]/10 border border-[#FF3B30]/30 px-3 py-2 text-xs text-[#FF3B30]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#00F0FF] hover:bg-[#00F0FF]/90 text-[#0A0C10] font-bold text-sm tracking-wide transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending 6-Digit Code...' : 'Send 6-Digit Code'}
              </button>

              {googleClientId && (
                <>
                  <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-slate-500">
                    <div className="h-px flex-1 bg-[#1E2532]" />
                    or
                    <div className="h-px flex-1 bg-[#1E2532]" />
                  </div>
                  <div ref={googleBtnRef} className="flex justify-center" />
                </>
              )}
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              {info && (
                <div className="rounded-lg bg-[#00F0FF]/10 border border-[#00F0FF]/25 px-3 py-2 text-xs text-cyan-200">
                  {info}
                </div>
              )}

              {devOtpCode && (
                <div className="rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/40 p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#F59E0B]">
                      <Sparkles className="w-3.5 h-3.5" />
                      Local DEV_MODE OTP
                    </div>
                    <div className="font-mono text-base font-bold text-amber-200 tracking-widest mt-0.5">
                      {devOtpCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOtpCode(devOtpCode)}
                    className="px-3 py-1.5 rounded-lg bg-[#F59E0B] hover:bg-amber-400 text-[#0A0C10] font-bold text-xs transition-colors shrink-0"
                  >
                    Auto-fill Dev OTP
                  </button>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                  6-Digit Verification Code
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full pl-10 pr-3.5 py-3 rounded-xl bg-[#0A0C10] border border-[#1E2532] focus:border-[#00F0FF] focus:outline-none text-center text-2xl tracking-[0.35em] font-mono font-bold text-[#00F0FF] placeholder:text-slate-700"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-[#FF3B30]/10 border border-[#FF3B30]/30 px-3 py-2 text-xs text-[#FF3B30]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otpCode.length !== 6}
                className="w-full py-2.5 px-4 rounded-xl bg-[#00F0FF] hover:bg-[#00F0FF]/90 text-[#0A0C10] font-bold text-sm tracking-wide transition-colors disabled:opacity-50"
              >
                {loading ? 'Verifying & Syncing...' : 'Verify & Sync Garage'}
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setError(null);
                    setInfo(null);
                    setDevOtpCode(null);
                  }}
                  className="text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Change email
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={(e) => void handleRequestOtp(e)}
                  className="text-[#00F0FF] hover:text-cyan-300 transition-colors disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
