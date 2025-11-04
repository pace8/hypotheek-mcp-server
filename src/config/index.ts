/**
 * Centralized configuration loader.
 */

import { createRequire } from 'node:module';
import { z } from 'zod';

import { ValidationError, ErrorCode } from '../types/index.js';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../../package.json') as { version: string };

export interface ServerConfig {
  replitApiKey: string;
  replitApiUrlBase: string;
  replitApiUrlBerekenen: string;
  replitApiUrlOpzet: string;
  replitApiUrlRentes: string;
  logLevel: string;
  nodeEnv: string;
  apiTimeoutMs: number;
  enableRetry: boolean;
  maxRetries: number;
  rateLimitPerSession: number;
  serverName: string;
  serverVersion: string;
}

const envSchema = z.object({
  REPLIT_API_KEY: z.string().min(1, 'REPLIT_API_KEY is verplicht'),
  REPLIT_API_URL_BASE: z.string().url().default('https://digital-mortgage-calculator.replit.app'),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.string().default('development'),
  API_TIMEOUT_MS: z.coerce.number().min(5000).max(60000).default(30000),
  ENABLE_RETRY: z.coerce.boolean().default(true),
  MAX_RETRIES: z.coerce.number().min(0).max(5).default(3),
  RATE_LIMIT_PER_SESSION: z.coerce.number().min(1).default(100),
});

function parseEnv(): z.infer<typeof envSchema> {
  const raw = {
    REPLIT_API_KEY: process.env.REPLIT_API_KEY ?? ((process.env.NODE_ENV || 'development') === 'test' ? 'test-replit-api-key' : undefined),
    REPLIT_API_URL_BASE: process.env.REPLIT_API_URL_BASE,
    LOG_LEVEL: process.env.LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
    API_TIMEOUT_MS: process.env.API_TIMEOUT_MS,
    ENABLE_RETRY: process.env.ENABLE_RETRY,
    MAX_RETRIES: process.env.MAX_RETRIES,
    RATE_LIMIT_PER_SESSION: process.env.RATE_LIMIT_PER_SESSION,
  };

  try {
    return envSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const message = issue?.message ?? 'Ongeldige configuratie';
      const field = issue?.path?.[0] ? String(issue.path[0]) : undefined;
      throw new ValidationError(ErrorCode.CONFIGURATION_ERROR, message, field);
    }
    throw error;
  }
}

export function loadConfig(): ServerConfig {
  const env = parseEnv();

  return {
    replitApiKey: env.REPLIT_API_KEY,
    replitApiUrlBase: env.REPLIT_API_URL_BASE,
    replitApiUrlBerekenen: `${env.REPLIT_API_URL_BASE}/berekenen/maximaal`,
    replitApiUrlOpzet: `${env.REPLIT_API_URL_BASE}/berekenen/opzet-hypotheek`,
    replitApiUrlRentes: `${env.REPLIT_API_URL_BASE}/rentes`,
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
    apiTimeoutMs: env.API_TIMEOUT_MS,
    enableRetry: env.ENABLE_RETRY,
    maxRetries: env.MAX_RETRIES,
    rateLimitPerSession: env.RATE_LIMIT_PER_SESSION,
    serverName: 'hypotheek-berekening-server',
    serverVersion: packageVersion,
  };
}

let configInstance: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export function resetConfig(): void {
  configInstance = null;
}
