import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';

export interface ILabViewProps {
  engine: ModulusEngine;
  storage: StorageSync;
}

export function EngineeringLab({ engine: _engine, storage: _storage }: ILabViewProps) {
  return null;
}
