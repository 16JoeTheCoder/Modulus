import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Coins,
  Globe,
  Lock,
  RefreshCw,
  ShieldAlert,
  UploadCloud,
} from 'lucide-react';
import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';
import {
  DEFAULT_BALANCE_CONFIG,
  type IAuditLogRecord,
  type IBalanceSnapshotRecord,
  type IGlobalBalanceConfig,
} from '../../core/types';
import { BrandingSeoTab } from './BrandingSeoTab';
import { EconomyUsersTab } from './EconomyUsersTab';
import { PhysicsTab } from './PhysicsTab';
import { PublishRollbackTab } from './PublishRollbackTab';
import type { IAdminDashboardPayload, IAdminLapRecord } from './types';

export interface IAdminPanelProps {
  engine: ModulusEngine;
  storage: StorageSync;
}

type AdminTab = 'physics' | 'economy' | 'branding' | 'publish';

export function AdminPanel({ engine, storage }: IAdminPanelProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('physics');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const [baseline, setBaseline] = useState<IGlobalBalanceConfig>(DEFAULT_BALANCE_CONFIG);
  const [staged, setStaged] = useState<IGlobalBalanceConfig>(DEFAULT_BALANCE_CONFIG);
  const [snapshots, setSnapshots] = useState<IBalanceSnapshotRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<IAuditLogRecord[]>([]);
  const [recentLaps, setRecentLaps] = useState<IAdminLapRecord[]>([]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 4500);
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch('/api/admin/config', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Partial<IAdminDashboardPayload> & {
        error?: string;
      };
      if (!res.ok || !data.activeConfig) {
        throw new Error(data.error ?? `Failed to load admin dashboard (${res.status})`);
      }

      setBaseline(data.activeConfig);
      setStaged(data.activeConfig);
      setSnapshots(data.snapshots ?? []);
      setAuditLogs(data.auditLogs ?? []);
      setRecentLaps(data.recentLaps ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Mission Control');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    const unsubAuth = engine.events.on('auth:changed', () => {
      void loadDashboard();
    });
    return () => unsubAuth();
  }, [engine, loadDashboard]);

  const hasChanges = useMemo(
    () => JSON.stringify(baseline) !== JSON.stringify(staged),
    [baseline, staged]
  );

  const navigateToSim = () => {
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handlePublish = async (notes: string) => {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ config: staged, notes }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        activeConfig?: IGlobalBalanceConfig;
        physicsChanged?: boolean;
        error?: string;
      };
      if (!res.ok || !data.activeConfig) {
        throw new Error(data.error ?? `Publish failed (${res.status})`);
      }

      engine.setBalanceConfig(data.activeConfig);
      setBaseline(data.activeConfig);
      setStaged(data.activeConfig);
      showToast(
        `Published ${data.activeConfig.version_id} to Edge KV${
          data.physicsChanged ? ' (Leaderboards Partitioned)' : ''
        }`
      );
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleRollback = async (versionId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/config/rollback/${encodeURIComponent(versionId)}`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as {
        activeConfig?: IGlobalBalanceConfig;
        error?: string;
      };
      if (!res.ok || !data.activeConfig) {
        throw new Error(data.error ?? `Rollback failed (${res.status})`);
      }

      engine.setBalanceConfig(data.activeConfig);
      setBaseline(data.activeConfig);
      setStaged(data.activeConfig);
      showToast(`Rolled back Edge KV to ${versionId}`);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed');
    }
  };

  const user = storage.getUser();

  if (loading && !forbidden) {
    return (
      <div className="min-h-full bg-[#0A0C10] text-slate-100 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 font-mono text-xs text-[#00F0FF]">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Connecting to Mission Control Edge API...
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-full bg-[#0A0C10] text-slate-100 flex items-center justify-center p-6 select-text">
        <div className="w-full max-w-md bg-[#12161F] border border-[#1E2532] rounded-2xl p-6 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-[#FF3B30]/15 border border-[#FF3B30]/40 text-[#FF3B30] flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="font-mono text-xs font-bold uppercase tracking-widest text-[#FF3B30]">
              403 Forbidden
            </div>
            <h1 className="text-lg font-bold text-slate-100 mt-1">
              Mission Control Access Restricted
            </h1>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              This console requires a verified 30-day Email OTP session listed in{' '}
              <code className="text-slate-200">ADMIN_EMAILS</code> with D1{' '}
              <code className="text-slate-200">role = &apos;admin&apos;</code>.
            </p>
            {user && (
              <p className="text-[11px] font-mono text-slate-500 mt-2">
                Signed in as: {user.email} ({user.role})
              </p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => engine.events.emit('auth:open-modal', undefined)}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#00F0FF] hover:bg-cyan-300 text-[#0A0C10] font-bold text-xs uppercase tracking-wider"
            >
              <Lock className="w-3.5 h-3.5" />
              {user ? 'Switch Account' : 'Sign In with Email OTP'}
            </button>
            <button
              type="button"
              onClick={navigateToSim}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0A0C10] hover:bg-slate-800 border border-[#1E2532] text-slate-200 font-semibold text-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Return to Simulator
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#0A0C10] text-slate-100 select-text pb-12">
      {/* Top Telemetry Header */}
      <header className="sticky top-0 z-30 bg-[#0A0C10]/95 backdrop-blur-md border-b border-[#1E2532]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={navigateToSim}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#12161F] hover:bg-slate-800 border border-[#1E2532] text-xs font-medium text-slate-300 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Return to Simulator
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold tracking-wider uppercase text-slate-100">
                  MODULUS <span className="text-[#00F0FF]">Mission Control</span>
                </h1>
                <span className="px-2 py-0.5 rounded bg-[#00F0FF]/15 border border-[#00F0FF]/35 font-mono text-[10px] font-bold text-[#00F0FF]">
                  {baseline.version_id}
                </span>
                {hasChanges && (
                  <span className="px-2 py-0.5 rounded bg-[#F59E0B]/15 border border-[#F59E0B]/40 font-mono text-[10px] font-bold text-[#F59E0B]">
                    STAGED CHANGES
                  </span>
                )}
              </div>
              <p className="text-[11px] font-mono text-slate-500">
                {user?.email ?? 'Admin'} · Edge KV Global Live-Tuning
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#12161F] hover:bg-slate-800 border border-[#1E2532] text-xs text-slate-300"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            {hasChanges && activeTab !== 'publish' && (
              <button
                type="button"
                onClick={() => setActiveTab('publish')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F59E0B] hover:bg-amber-400 text-[#0A0C10] font-bold text-xs"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Review & Publish
              </button>
            )}
          </div>
        </div>

        {/* Tab Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-1 overflow-x-auto">
          {(
            [
              { id: 'physics', label: '1. Physics & Math Biases', icon: Activity },
              { id: 'economy', label: '2. Economy & Users', icon: Coins },
              { id: 'branding', label: '3. Branding & SEO', icon: Globe },
              { id: 'publish', label: '4. Publish, Diff & Rollback', icon: UploadCloud },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  active
                    ? 'border-[#00F0FF] text-[#00F0FF] bg-[#00F0FF]/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 space-y-4">
        {toast && (
          <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-4 py-2.5 flex items-center gap-2 text-xs text-emerald-300 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {toast}
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-[#FF3B30]/10 border border-[#FF3B30]/40 px-4 py-2.5 text-xs text-[#FF3B30]">
            {error}
          </div>
        )}

        {activeTab === 'physics' && (
          <PhysicsTab
            baseline={baseline.physics_bias}
            staged={staged.physics_bias}
            onChange={(physics_bias) => setStaged((prev) => ({ ...prev, physics_bias }))}
          />
        )}

        {activeTab === 'economy' && (
          <EconomyUsersTab
            baseline={baseline.economy_bias}
            staged={staged.economy_bias}
            onChange={(economy_bias) => setStaged((prev) => ({ ...prev, economy_bias }))}
            recentLaps={recentLaps}
            onLapDeleted={(id) => setRecentLaps((prev) => prev.filter((l) => l.id !== id))}
            onActionSuccess={showToast}
          />
        )}

        {activeTab === 'branding' && (
          <BrandingSeoTab
            baseline={baseline.branding}
            staged={staged.branding}
            onChange={(branding) => setStaged((prev) => ({ ...prev, branding }))}
          />
        )}

        {activeTab === 'publish' && (
          <PublishRollbackTab
            baseline={baseline}
            staged={staged}
            snapshots={snapshots}
            auditLogs={auditLogs}
            hasChanges={hasChanges}
            publishing={publishing}
            onPublish={handlePublish}
            onRollback={handleRollback}
          />
        )}
      </main>
    </div>
  );
}
