import type { IAuthUser } from '../src/core/types';

export interface Env {
  DB: D1Database;
  MODULUS_KV: KVNamespace;
  ASSETS: Fetcher;
  DEV_MODE?: string;
  SESSION_TTL_DAYS?: string;
  SITE_URL?: string;
  JWT_SECRET?: string;
  ADMIN_EMAILS?: string;
  EMAIL_FROM?: string;
  EMAIL_API_KEY?: string;
}

export interface HonoVariables {
  user?: IAuthUser;
  sessionId?: string;
}

export type HonoEnv = {
  Bindings: Env;
  Variables: HonoVariables;
};
