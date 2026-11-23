import type { ModulusEngine } from '../core/Engine';
import type { StorageSync } from '../core/StorageSync';
import { EngineeringLab } from './lab';
import { DriveHud } from './hud';

export interface IAppShellProps {
  engine: ModulusEngine;
  storage: StorageSync;
}

export function AppShell({ engine, storage }: IAppShellProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 h-[100dvh] w-screen overflow-hidden">
      <EngineeringLab engine={engine} storage={storage} />
      <DriveHud engine={engine} storage={storage} />
    </div>
  );
}
