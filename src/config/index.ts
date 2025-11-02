/**
 * Centralized Configuration (Fase 1)
 * 
 * Alle configuratie op één plek, met validatie en defaults.
 */

import { ValidationError, ErrorCode } from '../types/index.js';

// ==============================================================================
// CONFIGURATION INTERFACE
// ==============================================================================

export interface ServerConfig {
  // API Configuration
  replitApiKey: string;
  replitApiUrlBase: string;
  replitApiUrlBerekenen: string;
  replitApiUrlOpzet: string;
  replitApiUrlRentes: string;
  
  // Logging
  logLevel: string;
  nodeEnv: string;
  
  // API Client Settings (voor Fase 2)
  apiTimeoutMs: number;
  enableRetry: boolean;
  maxRetries: number;
  
  // Rate Limiting (voor Fase 2)
  rateLimitPerSession: number;
  
  // Server Info
  serverName: string;
  serverVersion: string;
}

// ==============================================================================
// CONFIGURATION LOADING
// ==============================================================================

/**
 * Load en valideer configuratie uit environment variables
 */
export function loadConfig(): ServerConfig {
  // Check verplichte variabelen
  // Allow tests to run without requiring the real REPLIT_API_KEY.
  // In production and development we still require the variable, but in
  // the test environment we provide a harmless default to avoid throwing
  // during unit tests that instantiate API clients or middleware.
  let apiKey = process.env.REPLIT_API_KEY;
  if (!apiKey) {
    if ((process.env.NODE_ENV || 'development') === 'test') {
      apiKey = 'test-replit-api-key';
    } else {
      throw new ValidationError(
        ErrorCode.CONFIGURATION_ERROR,
        'REPLIT_API_KEY environment variabele is niet ingesteld. Zet deze in je .env file.',
        'REPLIT_API_KEY'
      );
    }
  }
  
  // Base URL met default
  const baseUrl = process.env.REPLIT_API_URL_BASE || 
    'https://digital-mortgage-calculator.replit.app';
  
  // Alle configuratie
  const config: ServerConfig = {
    // API
    replitApiKey: apiKey,
    replitApiUrlBase: baseUrl,
    replitApiUrlBerekenen: `${baseUrl}/berekenen/maximaal`,
    replitApiUrlOpzet: `${baseUrl}/berekenen/opzet-hypotheek`,
    replitApiUrlRentes: `${baseUrl}/rentes`,
    
    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
    nodeEnv: process.env.NODE_ENV || 'development',
    
    // API Client (defaults voor Fase 1)
    apiTimeoutMs: parseInt(process.env.API_TIMEOUT_MS || '30000', 10),
    enableRetry: process.env.ENABLE_RETRY !== 'false', // Default: true
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    
    // Rate Limiting (defaults voor Fase 2)
    rateLimitPerSession: parseInt(process.env.RATE_LIMIT_PER_SESSION || '100', 10),
    
    // Server Info
    serverName: 'hypotheek-berekening-server',
    serverVersion: '4.0.0'
  };
  
  // Valideer numerieke waarden
  if (config.apiTimeoutMs < 5000 || config.apiTimeoutMs > 60000) {
    throw new ValidationError(
      ErrorCode.CONFIGURATION_ERROR,
      'API_TIMEOUT_MS moet tussen 5000 en 60000 zijn',
      'API_TIMEOUT_MS',
      config.apiTimeoutMs
    );
  }
  
  if (config.maxRetries < 0 || config.maxRetries > 5) {
    throw new ValidationError(
      ErrorCode.CONFIGURATION_ERROR,
      'MAX_RETRIES moet tussen 0 en 5 zijn',
      'MAX_RETRIES',
      config.maxRetries
    );
  }
  
  return config;
}

/**
 * Global config instance
 */
let configInstance: ServerConfig | null = null;

/**
 * Get config (singleton pattern)
 */
export function getConfig(): ServerConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset config (voor testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
