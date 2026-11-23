import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';

export interface IDriveHudProps {
  engine: ModulusEngine;
  storage: StorageSync;
}

export function DriveHud({ engine: _engine, storage: _storage }: IDriveHudProps) {
  return null;
}
