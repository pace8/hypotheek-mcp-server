/**
 * Structured Logger met Winston (Fase 1)
 * 
 * Biedt structured logging met correlation IDs en verschillende log levels.
 */

import winston from 'winston';
import { LogLevel } from '../types/index.js';

// ==============================================================================
// LOGGER CONFIGURATION
// ==============================================================================

const logLevel = (process.env.LOG_LEVEL || 'info') as string;
const nodeEnv = process.env.NODE_ENV || 'development';

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
    version: '4.0.0',
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
    baseLogger.debug(message, this.getMeta(meta));
  }
  
  info(message: string, meta?: Record<string, unknown>): void {
    baseLogger.info(message, this.getMeta(meta));
  }
  
  warn(message: string, meta?: Record<string, unknown>): void {
    baseLogger.warn(message, this.getMeta(meta));
  }
  
  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
    const errorMeta = error instanceof Error ? {
      error: {
        name: error.name,
        message: error.message,
        stack: nodeEnv === 'development' ? error.stack : undefined
      }
    } : { error };
    
    baseLogger.error(message, this.getMeta({ ...errorMeta, ...meta }));
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
