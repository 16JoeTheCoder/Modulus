import { z } from 'zod';
import { GlobalBalanceConfigSchema, type IGlobalBalanceConfig } from './balance';
import { VehicleBuildConfigSchema, type IVehicleBuildConfig } from './vehicle';
import type { IAuthUser } from './plugin';

// Auth Schemas
export const RequestOtpBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
});

export const VerifyOtpBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  code: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6-digit code'),
});

// Garage & Economy Schemas
export const SaveBuildBodySchema = z.object({
  build: VehicleBuildConfigSchema,
  setActive: z.boolean().optional().default(true),
});

export const PurchasePartBodySchema = z.object({
  partId: z.string().min(1).max(80),
});

export const SubmitLapBodySchema = z.object({
  trackId: z.string().min(1).max(60),
  buildId: z.string().min(1).max(80).optional(),
  chassisId: z.string().min(1).max(60),
  balanceVersionId: z.string().min(1).max(40),
  lapTimeMs: z.number().int().min(5000).max(3_600_000),
  sectorTimesMs: z.tuple([z.number(), z.number(), z.number()]),
  peakSpeedKph: z.number().min(0).max(650),
  pwrRatio: z.number().min(0).max(5),
  isAiAssisted: z.boolean(),
  telemetrySummary: z.record(z.string(), z.unknown()).optional(),
});

// Admin Schemas
export const AdminPublishConfigBodySchema = z.object({
  config: GlobalBalanceConfigSchema,
  notes: z.string().max(300).optional().default(''),
});

export const AdminUserGrantBodySchema = z.object({
  credits_delta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  credits_exact: z.number().int().min(0).max(10_000_000).optional(),
  grant_part_ids: z.array(z.string().min(1)).optional(),
  revoke_part_ids: z.array(z.string().min(1)).optional(),
  unlock_all: z.boolean().optional(),
});

// API Response Types
export interface ISavedBuildRecord {
  id: string;
  name: string;
  chassisId: string;
  build: IVehicleBuildConfig;
  totalMassKg: number;
  peakPowerHp: number;
  pwrRatio: number;
  isActive: boolean;
  updatedAt: string;
}

export interface IGarageSyncResponse {
  user: IAuthUser;
  ownedPartIds: string[];
  builds: ISavedBuildRecord[];
}

export interface ILapLeaderboardEntry {
  id: string;
  userId: string;
  emailMasked: string;
  trackId: string;
  balanceVersionId: string;
  lapTimeMs: number;
  sectorTimesMs: number[];
  chassisId: string;
  peakSpeedKph: number;
  pwrRatio: number;
  isAiAssisted: boolean;
  createdAt: string;
}

export interface IBalanceSnapshotRecord {
  versionId: string;
  config: IGlobalBalanceConfig;
  publishedBy: string;
  notes: string;
  createdAt: string;
}

export interface IAuditLogRecord {
  id: string;
  adminEmail: string;
  action: string;
  targetUserId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface IAdminUserSummary {
  id: string;
  email: string;
  role: 'player' | 'admin';
  credits: number;
  unlockAll: boolean;
  buildsCount: number;
  ownedPartIds: string[];
  createdAt: string;
}

export interface IAdminDashboardConfigResponse {
  activeConfig: IGlobalBalanceConfig;
  snapshots: IBalanceSnapshotRecord[];
  auditLogs: IAuditLogRecord[];
}
