import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';

export interface IAdminPanelProps {
  engine: ModulusEngine;
  storage: StorageSync;
}

export function AdminPanel({ engine: _engine, storage: _storage }: IAdminPanelProps) {
  return (
    <div className="w-full h-full bg-[#0A0C10] text-slate-100 flex items-center justify-center p-6">
      <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-6 max-w-md text-center">
        <h1 className="text-xl font-bold text-[#00F0FF]">MODULUS Mission Control</h1>
        <p className="text-sm text-slate-400 mt-2">Admin panel shell ready for Worker 3.</p>
      </div>
    </div>
  );
}
