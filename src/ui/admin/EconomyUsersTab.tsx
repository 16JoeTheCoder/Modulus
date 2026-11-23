import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Coins,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unlock,
  Wrench,
} from 'lucide-react';
import { CHASSIS_CATALOG, PARTS_CATALOG } from '../../content';
import type { IAdminUserSummary, IEconomyBias } from '../../core/types';
import type { IAdminLapRecord } from './types';

interface EconomyUsersTabProps {
  baseline: IEconomyBias;
  staged: IEconomyBias;
  onChange: (next: IEconomyBias) => void;
  recentLaps: IAdminLapRecord[];
  onLapDeleted: (recordId: string) => void;
  onActionSuccess: (msg: string) => void;
}

export function EconomyUsersTab({
  baseline,
  staged,
  onChange,
  recentLaps,
  onLapDeleted,
  onActionSuccess,
}: EconomyUsersTabProps) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<IAdminUserSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [creditInputs, setCreditInputs] = useState<Record<string, string>>({});
  const [selectedPartByUser, setSelectedPartByUser] = useState<Record<string, string>>({});
  const [deletingLapId, setDeletingLapId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogItems = useMemo(
    () => [
      ...CHASSIS_CATALOG.map((c) => ({ id: c.id, label: `[Chassis] ${c.name} (${c.price} CR)` })),
      ...PARTS_CATALOG.map((p) => ({
        id: p.id,
        label: `[${p.module}] ${p.name} (${p.price} CR)`,
      })),
    ],
    []
  );

  const fetchUsers = useCallback(async (q: string) => {
    setLoadingUsers(true);
    setError(null);
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
      const res = await fetch(`/api/admin/users${qs}`, { credentials: 'include' });
      const data = (await res.json().catch(() => ({}))) as {
        users?: IAdminUserSummary[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Failed to load users (${res.status})`);
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers('');
  }, [fetchUsers]);

  const mutateUser = async (
    userId: string,
    payload: {
      credits_delta?: number;
      credits_exact?: number;
      grant_part_ids?: string[];
      revoke_part_ids?: string[];
      unlock_all?: boolean;
    },
    successLabel: string
  ) => {
    setBusyUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: IAdminUserSummary;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Grant failed (${res.status})`);
      if (data.user) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? data.user! : u)));
      }
      onActionSuccess(successLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'User update failed');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDeleteLap = async (recordId: string) => {
    setDeletingLapId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/leaderboards/${encodeURIComponent(recordId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Delete failed (${res.status})`);
      onLapDeleted(recordId);
      onActionSuccess(`Removed lap record ${recordId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete lap');
    } finally {
      setDeletingLapId(null);
    }
  };

  const formatLapMs = (ms: number) => {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    const rem = ms % 1000;
    return `${mins}:${secs.toString().padStart(2, '0')}.${rem.toString().padStart(3, '0')}`;
  };

  return (
    <div className="space-y-5">
      {/* Economy Sliders */}
      <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-3">
          Economy & Regulation Biases (Staged for KV)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {/* Payout Mult */}
          <div
            className={`rounded-lg p-3 border ${
              Math.abs(staged.payout_mult - baseline.payout_mult) > 1e-6
                ? 'bg-[#F59E0B]/5 border-[#F59E0B]/40'
                : 'bg-[#0A0C10]/70 border-[#1E2532]'
            }`}
          >
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-300 font-medium">Lap Payout</span>
              <span className="font-mono font-bold text-[#00F0FF]">
                {staged.payout_mult.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={5.0}
              step={0.05}
              value={staged.payout_mult}
              onChange={(e) =>
                onChange({ ...staged, payout_mult: Number.parseFloat(e.target.value) })
              }
              className="w-full accent-[#00F0FF]"
            />
          </div>

          {/* Part Price Mult */}
          <div
            className={`rounded-lg p-3 border ${
              Math.abs(staged.part_price_mult - baseline.part_price_mult) > 1e-6
                ? 'bg-[#F59E0B]/5 border-[#F59E0B]/40'
                : 'bg-[#0A0C10]/70 border-[#1E2532]'
            }`}
          >
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-300 font-medium">Part Prices</span>
              <span className="font-mono font-bold text-[#00F0FF]">
                {staged.part_price_mult.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={5.0}
              step={0.05}
              value={staged.part_price_mult}
              onChange={(e) =>
                onChange({ ...staged, part_price_mult: Number.parseFloat(e.target.value) })
              }
              className="w-full accent-[#00F0FF]"
            />
          </div>

          {/* Wear Cost Mult */}
          <div
            className={`rounded-lg p-3 border ${
              Math.abs(staged.wear_cost_mult - baseline.wear_cost_mult) > 1e-6
                ? 'bg-[#F59E0B]/5 border-[#F59E0B]/40'
                : 'bg-[#0A0C10]/70 border-[#1E2532]'
            }`}
          >
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-300 font-medium">Wear Cost</span>
              <span className="font-mono font-bold text-[#00F0FF]">
                {staged.wear_cost_mult.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min={0.0}
              max={5.0}
              step={0.05}
              value={staged.wear_cost_mult}
              onChange={(e) =>
                onChange({ ...staged, wear_cost_mult: Number.parseFloat(e.target.value) })
              }
              className="w-full accent-[#00F0FF]"
            />
          </div>

          {/* Starting Credits */}
          <div
            className={`rounded-lg p-3 border ${
              staged.starting_credits !== baseline.starting_credits
                ? 'bg-[#F59E0B]/5 border-[#F59E0B]/40'
                : 'bg-[#0A0C10]/70 border-[#1E2532]'
            }`}
          >
            <label className="block text-xs text-slate-300 font-medium mb-1">
              Starting Credits
            </label>
            <input
              type="number"
              min={0}
              max={10000000}
              step={1000}
              value={staged.starting_credits}
              onChange={(e) =>
                onChange({
                  ...staged,
                  starting_credits: Math.max(0, Number.parseInt(e.target.value || '0', 10)),
                })
              }
              className="w-full px-2.5 py-1 rounded bg-[#12161F] border border-[#1E2532] font-mono text-xs text-[#00F0FF]"
            />
          </div>

          {/* Max PWR Cap */}
          <div
            className={`rounded-lg p-3 border ${
              Math.abs(staged.max_pwr_ratio_cap - baseline.max_pwr_ratio_cap) > 1e-6
                ? 'bg-[#F59E0B]/5 border-[#F59E0B]/40'
                : 'bg-[#0A0C10]/70 border-[#1E2532]'
            }`}
          >
            <label className="block text-xs text-slate-300 font-medium mb-1">
              Max P/W Cap (0 = Off)
            </label>
            <input
              type="number"
              min={0}
              max={5}
              step={0.05}
              value={staged.max_pwr_ratio_cap}
              onChange={(e) =>
                onChange({
                  ...staged,
                  max_pwr_ratio_cap: Math.max(0, Number.parseFloat(e.target.value || '0')),
                })
              }
              className="w-full px-2.5 py-1 rounded bg-[#12161F] border border-[#1E2532] font-mono text-xs text-[#00F0FF]"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-[#FF3B30]/10 border border-[#FF3B30]/35 px-4 py-2.5 text-xs text-[#FF3B30]">
          {error}
        </div>
      )}

      {/* Live User Directory */}
      <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Live User Directory & Credit / Part Injector
            </h3>
            <p className="text-[11px] text-slate-400">
              Indexed lookup on D1 <code className="text-slate-300">users.email</code> &{' '}
              <code className="text-slate-300">users.id</code>. All mutations write to{' '}
              <code className="text-slate-300">audit_logs</code>.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void fetchUsers(query);
            }}
            className="flex items-center gap-2"
          >
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search email or usr_id..."
                className="pl-8 pr-3 py-1.5 rounded-lg bg-[#0A0C10] border border-[#1E2532] focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-slate-100 w-56"
              />
            </div>
            <button
              type="submit"
              disabled={loadingUsers}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 border border-[#00F0FF]/40 text-[#00F0FF] text-xs font-semibold transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
              Search
            </button>
          </form>
        </div>

        <div className="space-y-3">
          {users.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 font-mono">
              {loadingUsers ? 'Querying D1...' : 'No matching users found.'}
            </div>
          ) : (
            users.map((u) => {
              const isBusy = busyUserId === u.id;
              const deltaVal = creditInputs[u.id] ?? '50000';
              const pickedPart = selectedPartByUser[u.id] ?? catalogItems[0]?.id ?? '';
              const hasPicked = u.ownedPartIds.includes(pickedPart);

              return (
                <div
                  key={u.id}
                  className="rounded-xl bg-[#0A0C10] border border-[#1E2532] p-3.5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-slate-100">
                        {u.email}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          u.role === 'admin'
                            ? 'bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {u.role}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {u.buildsCount} builds · {u.ownedPartIds.length} parts
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-[#00F0FF]">
                        {u.credits.toLocaleString()} CR
                      </span>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void mutateUser(
                            u.id,
                            { unlock_all: !u.unlockAll },
                            `${!u.unlockAll ? 'Enabled' : 'Disabled'} Unlock-All Sandbox for ${u.email}`
                          )
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                          u.unlockAll
                            ? 'bg-[#F59E0B]/20 border-[#F59E0B]/50 text-[#F59E0B]'
                            : 'bg-[#12161F] border-[#1E2532] text-slate-300 hover:border-[#F59E0B]/40'
                        }`}
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        {u.unlockAll ? 'Unlock All: ON' : 'Unlock All'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 pt-2 border-t border-[#1E2532]">
                    {/* Inject Credits */}
                    <div className="flex items-center gap-2">
                      <Coins className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
                      <input
                        type="number"
                        value={deltaVal}
                        onChange={(e) =>
                          setCreditInputs((prev) => ({ ...prev, [u.id]: e.target.value }))
                        }
                        className="w-28 px-2 py-1 rounded bg-[#12161F] border border-[#1E2532] font-mono text-xs text-slate-100"
                      />
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          const amt = Number.parseInt(deltaVal, 10);
                          if (!Number.isFinite(amt)) return;
                          void mutateUser(
                            u.id,
                            { credits_delta: amt },
                            `Injected ${amt >= 0 ? '+' : ''}${amt.toLocaleString()} CR to ${u.email}`
                          );
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 border border-[#00F0FF]/35 text-[#00F0FF] text-[11px] font-semibold"
                      >
                        <Plus className="w-3 h-3" />
                        Add CR
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          const amt = Number.parseInt(deltaVal, 10);
                          if (!Number.isFinite(amt) || amt < 0) return;
                          void mutateUser(
                            u.id,
                            { credits_exact: amt },
                            `Set ${u.email} balance to ${amt.toLocaleString()} CR`
                          );
                        }}
                        className="px-2.5 py-1 rounded bg-[#12161F] hover:bg-slate-800 border border-[#1E2532] text-slate-300 text-[11px] font-medium"
                      >
                        Set Exact
                      </button>
                    </div>

                    {/* Grant / Revoke Part */}
                    <div className="flex items-center gap-2">
                      <Wrench className="w-3.5 h-3.5 text-[#00F0FF] shrink-0" />
                      <select
                        value={pickedPart}
                        onChange={(e) =>
                          setSelectedPartByUser((prev) => ({ ...prev, [u.id]: e.target.value }))
                        }
                        className="flex-1 min-w-0 px-2 py-1 rounded bg-[#12161F] border border-[#1E2532] text-xs text-slate-200 font-mono"
                      >
                        {catalogItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isBusy || !pickedPart}
                        onClick={() =>
                          void mutateUser(
                            u.id,
                            hasPicked
                              ? { revoke_part_ids: [pickedPart] }
                              : { grant_part_ids: [pickedPart] },
                            `${hasPicked ? 'Revoked' : 'Granted'} ${pickedPart} for ${u.email}`
                          )
                        }
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold shrink-0 border ${
                          hasPicked
                            ? 'bg-[#FF3B30]/15 border-[#FF3B30]/40 text-[#FF3B30]'
                            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        }`}
                      >
                        {hasPicked ? 'Revoke' : 'Grant Part'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Leaderboard Moderation */}
      <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-4 space-y-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Leaderboard Moderation (Recent 30 Laps Across Versions)
          </h3>
          <p className="text-[11px] text-slate-400">
            Remove invalid or cheated lap times directly from D1{' '}
            <code className="text-slate-300">lap_records</code>.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#1E2532] text-[10px] uppercase text-slate-400">
                <th className="py-2 pr-3">Driver</th>
                <th className="py-2 pr-3">Track</th>
                <th className="py-2 pr-3">Version</th>
                <th className="py-2 pr-3">Lap Time</th>
                <th className="py-2 pr-3">Vmax</th>
                <th className="py-2 pr-3">Mode</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E2532]/70">
              {recentLaps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    No recorded laps in D1 yet.
                  </td>
                </tr>
              ) : (
                recentLaps.map((lap) => (
                  <tr key={lap.id} className="hover:bg-[#0A0C10]/60">
                    <td className="py-2 pr-3 text-slate-200">{lap.email}</td>
                    <td className="py-2 pr-3 text-slate-300">{lap.trackId}</td>
                    <td className="py-2 pr-3 text-[#00F0FF]">{lap.balanceVersionId}</td>
                    <td className="py-2 pr-3 font-bold text-slate-100">
                      {formatLapMs(lap.lapTimeMs)}
                    </td>
                    <td className="py-2 pr-3 text-slate-400">
                      {Math.round(lap.peakSpeedKph)} km/h
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          lap.isAiAssisted
                            ? 'bg-[#F59E0B]/15 text-[#F59E0B]'
                            : 'bg-emerald-500/15 text-emerald-400'
                        }`}
                      >
                        {lap.isAiAssisted ? 'AI' : 'MANUAL'}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={deletingLapId === lap.id}
                        onClick={() => void handleDeleteLap(lap.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#FF3B30]/15 hover:bg-[#FF3B30]/25 border border-[#FF3B30]/40 text-[#FF3B30] text-[10px] font-semibold disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
