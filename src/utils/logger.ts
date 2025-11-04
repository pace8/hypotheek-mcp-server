/**
 * Structured Logger met Winston (Fase 1)
 * 
 * Biedt structured logging met correlation IDs en verschillende log levels.
 */

import winston from 'winston';
import { LogLevel } from '../types/index.js';
import { applyRedaction, RedactionLevel } from './pii-scrubber.js';
import { getConfig } from '../config/index.js';

// ==============================================================================
// LOGGER CONFIGURATION
// ==============================================================================

const logLevel = (process.env.LOG_LEVEL || 'info') as string;
const nodeEnv = process.env.NODE_ENV || 'development';
const { serverVersion } = getConfig();

/**
 * Custom log format
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
  nodeEnv === 'production' 
    ? winston.format.json()  // JSON in productie
    : winston.format.printf((info: any) => {
        // Human-readable in development
        const { level, message, timestamp, metadata } = info;
        const metaStr = Object.keys(metadata || {}).length > 0 
          ? ` ${JSON.stringify(metadata)}` 
          : '';
        return `${timestamp} [${level.toUpperCase()}]: ${message}${metaStr}`;
      })
);

/**
 * Base Winston logger
 */
const baseLogger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: {
    service: 'hypotheek-mcp-server',
    version: serverVersion,
    environment: nodeEnv
  },
  transports: [
    // Console transport voor stdio
    new winston.transports.Console({
      // In MCP context gaan logs naar stderr
      stderrLevels: ['error', 'warn', 'info', 'debug']
    })
  ]
});

// ==============================================================================
// CORRELATION LOGGER
// ==============================================================================

/**
 * Logger met correlation ID support
 */
export class CorrelatedLogger {
  private correlationId?: string;
  
  constructor(correlationId?: string) {
    this.correlationId = correlationId;
  }
  
  /**
   * Get metadata met correlation ID
   */
  private getMeta(meta?: Record<string, unknown>): Record<string, unknown> {
    return {
      ...meta,
      ...(this.correlationId && { correlation_id: this.correlationId })
    };
  }
  
  debug(message: string, meta?: Record<string, unknown>): void {
    const sanitizedMeta = meta ? applyRedaction(meta) : undefined;
    baseLogger.debug(message, this.getMeta(sanitizedMeta));
  }
  
  info(message: string, meta?: Record<string, unknown>): void {
    const sanitizedMeta = meta ? applyRedaction(meta) : undefined;
    baseLogger.info(message, this.getMeta(sanitizedMeta));
  }
  
  warn(message: string, meta?: Record<string, unknown>): void {
    const sanitizedMeta = meta ? applyRedaction(meta) : undefined;
    baseLogger.warn(message, this.getMeta(sanitizedMeta));
  }
  
  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
    const sanitizedMeta = meta ? applyRedaction(meta) : undefined;

    const errorMeta = error instanceof Error ? {
      error: {
        name: error.name,
        message: nodeEnv === 'development' ? error.message : '[REDACTED]',
        stack: nodeEnv === 'development' ? error.stack : undefined
      }
    } : { error };

    // Combine error metadata with sanitized meta, then apply redaction once more to be safe
    const combined = { ...errorMeta, ...(sanitizedMeta || {}) } as Record<string, unknown>;
    const finalMeta = applyRedaction(combined);

    baseLogger.error(message, this.getMeta(finalMeta));
  }
  
  /**
   * Log validatie warning (Fase 1: warnings only, niet blocking)
   */
  validationWarning(message: string, field?: string, value?: unknown): void {
    this.warn('Validation warning', {
      validation_message: message,
      field,
      value,
      phase: 'fase-1-warning-only'
    });
  }
}

/**
 * Create logger met optionele correlation ID
 */
export function createLogger(correlationId?: string): CorrelatedLogger {
  return new CorrelatedLogger(correlationId);
}

/**
 * Default logger (zonder correlation ID)
 */
export const logger = new CorrelatedLogger();

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

/**
 * Sanitize object voor logging (verwijder potentiële PII)
 * Fase 1: Basic implementation, uitgebreid in Fase 3
 */
export function sanitizeForLogging(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...obj };
  
  // In Fase 1: alleen session_id behouden, rest verbergen
  const allowedFields = ['session_id', 'tool_name', 'duration_ms', 'status'];
  
  Object.keys(sanitized).forEach(key => {
    if (!allowedFields.includes(key)) {
      if (key.includes('inkomen') || key.includes('geboortedatum')) {
        sanitized[key] = '[REDACTED]';
      }
    }
  });
  
  return sanitized;
}
