import type {
  IAuditLogRecord,
  IBalanceSnapshotRecord,
  IGlobalBalanceConfig,
} from '../../core/types';

export interface IAdminLapRecord {
  id: string;
  userId: string;
  email: string;
  trackId: string;
  balanceVersionId: string;
  lapTimeMs: number;
  chassisId: string;
  peakSpeedKph: number;
  pwrRatio: number;
  isAiAssisted: boolean;
  createdAt: string;
}

export interface IAdminDashboardPayload {
  activeConfig: IGlobalBalanceConfig;
  snapshots: IBalanceSnapshotRecord[];
  auditLogs: IAuditLogRecord[];
  recentLaps: IAdminLapRecord[];
}
