import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  History,
  RotateCcw,
  ScrollText,
  UploadCloud,
} from 'lucide-react';
import {
  didPhysicsBiasChange,
  type IAuditLogRecord,
  type IBalanceSnapshotRecord,
  type IGlobalBalanceConfig,
} from '../../core/types';

interface PublishRollbackTabProps {
  baseline: IGlobalBalanceConfig;
  staged: IGlobalBalanceConfig;
  snapshots: IBalanceSnapshotRecord[];
  auditLogs: IAuditLogRecord[];
  hasChanges: boolean;
  publishing: boolean;
  onPublish: (notes: string) => Promise<void>;
  onRollback: (versionId: string) => Promise<void>;
}

export function PublishRollbackTab({
  baseline,
  staged,
  snapshots,
  auditLogs,
  hasChanges,
  publishing,
  onPublish,
  onRollback,
}: PublishRollbackTabProps) {
  const [notes, setNotes] = useState('');
  const [confirmPhysicsOpen, setConfirmPhysicsOpen] = useState(false);
  const [rollingBackVersion, setRollingBackVersion] = useState<string | null>(null);

  const physicsChanged = useMemo(
    () => didPhysicsBiasChange(baseline.physics_bias, staged.physics_bias),
    [baseline.physics_bias, staged.physics_bias]
  );

  const diffLines = useMemo(() => {
    const baseLines = JSON.stringify(baseline, null, 2).split('\n');
    const stagedLines = JSON.stringify(staged, null, 2).split('\n');
    const maxLen = Math.max(baseLines.length, stagedLines.length);
    const rows: Array<{ base: string; next: string; changed: boolean }> = [];
    for (let i = 0; i < maxLen; i++) {
      const b = baseLines[i] ?? '';
      const n = stagedLines[i] ?? '';
      rows.push({ base: b, next: n, changed: b !== n });
    }
    return rows;
  }, [baseline, staged]);

  const handlePublishClick = () => {
    if (physicsChanged) {
      setConfirmPhysicsOpen(true);
    } else {
      void onPublish(notes).then(() => setNotes(''));
    }
  };

  const handleConfirmPublish = async () => {
    setConfirmPhysicsOpen(false);
    await onPublish(notes);
    setNotes('');
  };

  const handleRollback = async (versionId: string) => {
    setRollingBackVersion(versionId);
    try {
      await onRollback(versionId);
    } finally {
      setRollingBackVersion(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Side-by-Side JSON Diff + Publish Bar */}
      <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Staged JSON Diff Preview (KV Baseline vs. Staged)
            </h3>
            <p className="text-[11px] text-slate-400">
              Modified lines highlighted in <span className="text-[#F59E0B] font-mono">#F59E0B</span>.
            </p>
          </div>
          {physicsChanged && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#F59E0B] text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5" />
              Physics Bias Changed — Will Partition Leaderboards
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 font-mono text-[11px]">
          <div className="rounded-lg bg-[#0A0C10] border border-[#1E2532] overflow-hidden">
            <div className="px-3 py-1.5 border-b border-[#1E2532] text-[10px] uppercase text-slate-400">
              Active Edge KV ({baseline.version_id})
            </div>
            <div className="p-2.5 max-h-72 overflow-auto space-y-0.5">
              {diffLines.map((row, idx) => (
                <div
                  key={`b-${idx}`}
                  className={`whitespace-pre px-1.5 rounded ${
                    row.changed ? 'bg-[#FF3B30]/10 text-red-300' : 'text-slate-400'
                  }`}
                >
                  {row.base}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-[#0A0C10] border border-[#1E2532] overflow-hidden">
            <div className="px-3 py-1.5 border-b border-[#1E2532] text-[10px] uppercase text-[#00F0FF]">
              Staged Payload {physicsChanged ? '(Auto-Bump Version)' : ''}
            </div>
            <div className="p-2.5 max-h-72 overflow-auto space-y-0.5">
              {diffLines.map((row, idx) => (
                <div
                  key={`n-${idx}`}
                  className={`whitespace-pre px-1.5 rounded ${
                    row.changed ? 'bg-[#F59E0B]/15 text-[#F59E0B] font-semibold' : 'text-slate-300'
                  }`}
                >
                  {row.next}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Publish Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2 border-t border-[#1E2532]">
          <input
            type="text"
            maxLength={300}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Release notes (e.g. +5% Pacejka grip for GP Circuit balance pass)..."
            className="flex-1 px-3 py-2 rounded-lg bg-[#0A0C10] border border-[#1E2532] focus:border-[#00F0FF] focus:outline-none text-xs text-slate-100"
          />
          <button
            type="button"
            disabled={!hasChanges || publishing}
            onClick={handlePublishClick}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#00F0FF] hover:bg-cyan-300 text-[#0A0C10] font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-40"
          >
            <UploadCloud className="w-4 h-4" />
            {publishing ? 'Publishing to Edge KV...' : 'Publish to Edge (KV)'}
          </button>
        </div>

        {/* Physics Partitioning Confirmation Banner */}
        {confirmPhysicsOpen && (
          <div className="rounded-xl bg-[#FF3B30]/10 border border-[#FF3B30]/45 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#FF3B30]">
                <AlertTriangle className="w-4 h-4" />
                Confirm Leaderboard Partitioning
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                You modified <code className="text-[#F59E0B]">physics_bias</code> multipliers.
                Publishing will auto-increment <code className="text-[#00F0FF]">version_id</code>{' '}
                and start a fresh leaderboard partition so prior lap records remain uncorrupted.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmPhysicsOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-[#0A0C10] border border-[#1E2532] text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmPublish()}
                className="px-4 py-1.5 rounded-lg bg-[#FF3B30] hover:bg-red-500 text-white font-bold text-xs"
              >
                Confirm & Partition
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Grid: Snapshot History + Audit Logs */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Snapshot History Rollback */}
        <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#00F0FF]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Snapshot History (1-Click Rollback)
            </h3>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {snapshots.length === 0 ? (
              <div className="text-xs text-slate-500 font-mono py-6 text-center">
                No snapshots archived in D1 yet. Publish once to create the first snapshot.
              </div>
            ) : (
              snapshots.map((snap) => {
                const isActive = snap.versionId === baseline.version_id;
                return (
                  <div
                    key={snap.versionId}
                    className={`rounded-lg p-3 border flex items-center justify-between gap-3 ${
                      isActive
                        ? 'bg-[#00F0FF]/5 border-[#00F0FF]/35'
                        : 'bg-[#0A0C10] border-[#1E2532]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#00F0FF]">
                          {snap.versionId}
                        </span>
                        {isActive && (
                          <span className="px-1.5 py-0.5 rounded bg-[#00F0FF]/20 text-[#00F0FF] text-[10px] font-bold">
                            LIVE
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-300 truncate mt-0.5">
                        {snap.notes || 'No release notes'}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                        {snap.publishedBy} · {new Date(snap.createdAt).toLocaleString()}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isActive || rollingBackVersion === snap.versionId}
                      onClick={() => void handleRollback(snap.versionId)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#12161F] hover:bg-slate-800 border border-[#1E2532] text-[11px] font-semibold text-slate-200 shrink-0 disabled:opacity-40"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {rollingBackVersion === snap.versionId ? 'Restoring...' : 'Rollback'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Immutable Audit Logs */}
        <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-[#F59E0B]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Immutable Admin Audit Logs
            </h3>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1 font-mono text-[11px]">
            {auditLogs.length === 0 ? (
              <div className="text-xs text-slate-500 py-6 text-center">
                No audit entries recorded yet.
              </div>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-lg bg-[#0A0C10] border border-[#1E2532] p-2.5 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#F59E0B]">{log.action}</span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    by <span className="text-slate-200">{log.adminEmail}</span>
                    {log.targetUserId ? ` · target ${log.targetUserId}` : ''}
                  </div>
                  <div className="text-[10px] text-slate-500 break-all">
                    {JSON.stringify(log.payload)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
