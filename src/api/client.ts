/**
 * API Client met Retry Logic en Timeout (Fase 2)
 * 
 * Features:
 * - Exponential backoff retry
 * - Configurable timeout
 * - Error mapping naar ErrorCode
 * - Correlation ID injection
 */

import { getConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { APIError, ErrorCode } from '../types/index.js';
import { withCircuitBreaker } from '../middleware/circuit-breaker.js';

// ==============================================================================
// TYPES
// ==============================================================================

export interface ApiClientOptions {
  timeout?: number;
  maxRetries?: number;
  enableRetry?: boolean;
  correlationId?: string;
}

export interface ApiResponse<T = unknown> {
  data: T;
  statusCode: number;
  headers: Record<string, string>;
  duration: number;
}

// ==============================================================================
// RETRY CONFIGURATION
// ==============================================================================

const RETRY_CONFIG = {
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitterFactor: 0.1
};

/**
 * Bereken retry delay met exponential backoff + jitter
 */
function calculateRetryDelay(attemptNumber: number): number {
  const baseDelay = Math.min(
    RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attemptNumber),
    RETRY_CONFIG.maxDelayMs
  );
  
  // Add jitter (-10% to +10%)
  const jitter = baseDelay * RETRY_CONFIG.jitterFactor * (Math.random() * 2 - 1);
  return Math.floor(baseDelay + jitter);
}

/**
 * Check of error retryable is
 */
function isRetryableError(statusCode?: number): boolean {
  if (!statusCode) return true; // Network errors zijn retryable
  
  // Retry op: 408 (timeout), 429 (rate limit), 5xx (server errors)
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

// ==============================================================================
// API CLIENT
// ==============================================================================

export class ApiClient {
  private config = getConfig();
  
  /**
   * POST request met retry logic
   */
  async post<T = unknown>(
    url: string,
    body: unknown,
    options: ApiClientOptions = {}
  ): Promise<ApiResponse<T>> {
    const {
      timeout = this.config.apiTimeoutMs,
      maxRetries = this.config.maxRetries,
      enableRetry = this.config.enableRetry,
      correlationId
    } = options;
    
    const logger = createLogger(correlationId);
    const startTime = Date.now();
    
    let lastError: Error | undefined;
    const attemptCount = enableRetry ? maxRetries + 1 : 1;
    
    for (let attempt = 0; attempt < attemptCount; attempt++) {
      try {
        logger.debug('API request attempt', {
          url,
          attempt: attempt + 1,
          maxAttempts: attemptCount,
          timeout
        });
        
        const response = await this.makeRequest<T>(url, body, timeout, correlationId);
        
        const duration = Date.now() - startTime;
        logger.info('API request successful', {
          url,
          statusCode: response.statusCode,
          duration,
          attempts: attempt + 1
        });
        
        return response;
        
      } catch (error) {
        lastError = error as Error;
        const statusCode = (error as any).statusCode;
        
        // Log error
        logger.warn('API request failed', {
          url,
          attempt: attempt + 1,
          maxAttempts: attemptCount,
          error: error instanceof Error ? error.message : String(error),
          statusCode
        });
        
        // Check of we moeten retrying
        if (attempt < attemptCount - 1 && isRetryableError(statusCode)) {
          const retryDelay = calculateRetryDelay(attempt);
          logger.info('Retrying after delay', {
            attempt: attempt + 1,
            retryDelay,
            nextAttempt: attempt + 2
          });
          
          await this.sleep(retryDelay);
          continue;
        }
        
        // Geen retry meer mogelijk
        break;
      }
    }
    
    // Alle retries gefaald
    const duration = Date.now() - startTime;
    logger.error('API request failed after all retries', lastError, {
      url,
      attempts: attemptCount,
      duration
    });
    
    throw this.mapToAPIError(lastError!, url);
  }
  
  /**
   * GET request met retry logic
   */
  async get<T = unknown>(
    url: string,
    options: ApiClientOptions = {}
  ): Promise<ApiResponse<T>> {
    const {
      timeout = this.config.apiTimeoutMs,
      maxRetries = this.config.maxRetries,
      enableRetry = this.config.enableRetry,
      correlationId
    } = options;
    
    const logger = createLogger(correlationId);
    const startTime = Date.now();
    
    let lastError: Error | undefined;
    const attemptCount = enableRetry ? maxRetries + 1 : 1;
    
    for (let attempt = 0; attempt < attemptCount; attempt++) {
      try {
        logger.debug('API GET request attempt', {
          url,
          attempt: attempt + 1,
          maxAttempts: attemptCount,
          timeout
        });
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.config.replitApiKey}`,
            'Content-Type': 'application/json',
            ...(correlationId && { 'X-Correlation-ID': correlationId })
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        const duration = Date.now() - startTime;
        
        logger.info('API GET request successful', {
          url,
          statusCode: response.status,
          duration,
          attempts: attempt + 1
        });
        
        return {
          data: data as T,
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          duration
        };
        
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < attemptCount - 1 && isRetryableError()) {
          const retryDelay = calculateRetryDelay(attempt);
          logger.info('Retrying GET after delay', {
            attempt: attempt + 1,
            retryDelay
          });
          await this.sleep(retryDelay);
          continue;
        }
        
        break;
      }
    }
    
    const duration = Date.now() - startTime;
    logger.error('API GET request failed', lastError, {
      url,
      duration
    });
    
    throw this.mapToAPIError(lastError!, url);
  }
  
  /**
   * Internal: Make single HTTP request
   */
  private async makeRequest<T>(
    url: string,
    body: unknown,
    timeout: number,
    correlationId?: string
  ): Promise<ApiResponse<T>> {
    // Wrap the HTTP call in a circuit breaker to protect downstream API
    return withCircuitBreaker(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.replitApiKey}`,
            'Content-Type': 'application/json',
            ...(correlationId && { 'X-Correlation-ID': correlationId })
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(`HTTP ${response.status}: ${errorText}`);
          (error as any).statusCode = response.status;
          throw error;
        }

        const data = await response.json();

        return {
          data: data as T,
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          duration: 0
        };

      } catch (error) {
        clearTimeout(timeoutId);

        if ((error as Error).name === 'AbortError') {
          const timeoutError = new Error(`Request timeout after ${timeout}ms`);
          (timeoutError as any).statusCode = 408;
          throw timeoutError;
        }

        throw error;
      }
    });
  }
  
  /**
   * Map errors naar APIError met ErrorCode
   */
  private mapToAPIError(error: Error, url: string): APIError {
    const statusCode = (error as any).statusCode;
    
    // Timeout
    if (statusCode === 408 || error.message.includes('timeout')) {
      return new APIError(
        ErrorCode.API_TIMEOUT,
        `API request timed out: ${url}`,
        408,
        this.config.apiTimeoutMs
      );
    }
    
    // Rate limit
    if (statusCode === 429) {
      const retryAfter = 60000; // Default: 1 min
      return new APIError(
        ErrorCode.API_RATE_LIMIT,
        'API rate limit exceeded. Please try again later.',
        429,
        retryAfter
      );
    }
    
    // Generic API error
    return new APIError(
      ErrorCode.API_ERROR,
      `API request failed: ${error.message}`,
      statusCode,
      undefined
    );
  }
  
  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==============================================================================
// SINGLETON INSTANCE
// ==============================================================================

let clientInstance: ApiClient | null = null;

/**
 * Get API client (singleton)
 */
export function getApiClient(): ApiClient {
  if (!clientInstance) {
    clientInstance = new ApiClient();
  }
  return clientInstance;
}

/**
 * Reset client (voor testing)
 */
export function resetApiClient(): void {
  clientInstance = null;
}
