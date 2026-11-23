import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';

export interface IAuthModalProps {
  engine: ModulusEngine;
  storage: StorageSync;
}

export function AuthModal({ engine: _engine, storage: _storage }: IAuthModalProps) {
  return null;
}
