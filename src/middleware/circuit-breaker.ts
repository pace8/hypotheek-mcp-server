/**
 * Circuit Breaker Pattern (Fase 3)
 * 
 * Voorkomt cascade failures door failing requests te stoppen voordat ze
 * de backend overbelasten. Gebruikt een state machine met CLOSED, OPEN, en HALF_OPEN states.
 */

import { getConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { APIError, ErrorCode } from '../types/index.js';

// ==============================================================================
// TYPES
// ==============================================================================

export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal operation
  OPEN = 'OPEN',           // Blocking all requests
  HALF_OPEN = 'HALF_OPEN'  // Testing if backend recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Failures before opening (default: 5)
  successThreshold: number;      // Successes to close from half-open (default: 2)
  timeout: number;               // Time to wait before half-open (ms, default: 30000)
  monitoringPeriod: number;      // Window for counting failures (ms, default: 60000)
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: number;
  nextAttemptAt?: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
}

// ==============================================================================
// CIRCUIT BREAKER
// ==============================================================================

export class CircuitBreaker {
  private logger = createLogger();
  private config: CircuitBreakerConfig;
  
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime?: number;
  private nextAttemptAt?: number;
  
  // Statistics
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private failureTimestamps: number[] = [];
  
  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30_000,        // 30 seconds
      monitoringPeriod: 60_000, // 1 minute
      ...config
    };
    
    this.logger.info('Circuit breaker initialized', {
      failure_threshold: this.config.failureThreshold,
      success_threshold: this.config.successThreshold,
      timeout_ms: this.config.timeout
    });
  }
  
  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;
    
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (this.nextAttemptAt && Date.now() < this.nextAttemptAt) {
        this.logger.warn('Circuit breaker is OPEN - request blocked', {
          next_attempt_at: new Date(this.nextAttemptAt).toISOString(),
          time_remaining_ms: this.nextAttemptAt - Date.now()
        });
        
        throw new APIError(
          ErrorCode.API_ERROR,
          'Service temporarily unavailable (circuit breaker open)',
          503,
          this.nextAttemptAt - Date.now()
        );
      }
      
      // Timeout expired, try half-open
      this.toHalfOpen();
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  /**
   * Record a success
   */
  private onSuccess(): void {
    this.totalSuccesses++;
    this.failureTimestamps = []; // Clear failure window
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      
      this.logger.info('Circuit breaker: success in HALF_OPEN state', {
        successes: this.successes,
        threshold: this.config.successThreshold
      });
      
      if (this.successes >= this.config.successThreshold) {
        this.toClosed();
      }
    }
  }
  
  /**
   * Record a failure
   */
  private onFailure(): void {
    this.totalFailures++;
    this.failures++;
    this.lastFailureTime = Date.now();
    
    // Add to failure timestamps for monitoring window
    this.failureTimestamps.push(this.lastFailureTime);
    this.cleanupOldFailures();
    
    this.logger.warn('Circuit breaker: failure recorded', {
      state: this.state,
      failures: this.failures,
      threshold: this.config.failureThreshold,
      failures_in_window: this.failureTimestamps.length
    });
    
    if (this.state === CircuitState.HALF_OPEN) {
      // Immediate trip to OPEN on failure in HALF_OPEN
      this.toOpen();
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we should trip
      if (this.failureTimestamps.length >= this.config.failureThreshold) {
        this.toOpen();
      }
    }
  }
  
  /**
   * Transition to CLOSED state
   */
  private toClosed(): void {
    this.logger.info('Circuit breaker: CLOSED', {
      previous_state: this.state,
      total_failures: this.totalFailures,
      total_successes: this.totalSuccesses
    });
    
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.nextAttemptAt = undefined;
  }
  
  /**
   * Transition to OPEN state
   */
  private toOpen(): void {
    this.nextAttemptAt = Date.now() + this.config.timeout;
    
    this.logger.error('Circuit breaker: OPEN - blocking requests', undefined, {
      previous_state: this.state,
      failures: this.failures,
      next_attempt_at: new Date(this.nextAttemptAt).toISOString(),
      timeout_ms: this.config.timeout
    });
    
    this.state = CircuitState.OPEN;
    this.successes = 0;
  }
  
  /**
   * Transition to HALF_OPEN state
   */
  private toHalfOpen(): void {
    this.logger.info('Circuit breaker: HALF_OPEN - testing backend', {
      previous_state: this.state
    });
    
    this.state = CircuitState.HALF_OPEN;
    this.failures = 0;
    this.successes = 0;
  }
  
  /**
   * Cleanup old failures outside monitoring window
   */
  private cleanupOldFailures(): void {
    const cutoff = Date.now() - this.config.monitoringPeriod;
    this.failureTimestamps = this.failureTimestamps.filter(t => t > cutoff);
  }
  
  /**
   * Get current stats
   */
  getStats(): CircuitBreakerStats {
    this.cleanupOldFailures();
    
    return {
      state: this.state,
      failures: this.failureTimestamps.length,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      nextAttemptAt: this.nextAttemptAt,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses
    };
  }
  
  /**
   * Force reset (for testing)
   */
  reset(): void {
    this.logger.info('Circuit breaker: manual reset');
    
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = undefined;
    this.nextAttemptAt = undefined;
    this.failureTimestamps = [];
  }
  
  /**
   * Force open (for testing/maintenance)
   */
  forceOpen(): void {
    this.logger.warn('Circuit breaker: forced OPEN');
    this.toOpen();
  }
}

// ==============================================================================
// SINGLETON INSTANCE
// ==============================================================================

let breakerInstance: CircuitBreaker | null = null;

/**
 * Get circuit breaker (singleton)
 */
export function getCircuitBreaker(): CircuitBreaker {
  if (!breakerInstance) {
    breakerInstance = new CircuitBreaker();
  }
  return breakerInstance;
}

/**
 * Reset circuit breaker (for testing)
 */
export function resetCircuitBreaker(): void {
  breakerInstance = null;
}

/**
 * Wrap API client with circuit breaker
 */
export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  const breaker = getCircuitBreaker();
  return breaker.execute(fn);
}
