/**
 * Rate Limiter Middleware (Fase 2)
 * 
 * Features:
 * - Per-session rate limiting
 * - Sliding window algorithm
 * - Configurable limits
 * - Automatic cleanup
 */

import { getConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { APIError, ErrorCode } from '../types/index.js';

// ==============================================================================
// TYPES
// ==============================================================================

interface RateLimitEntry {
  requests: number[];  // Timestamps van requests
  firstRequestAt: number;
}

interface RateLimitInfo {
  allowed: boolean;
  current: number;
  limit: number;
  resetAt: number;
  retryAfter?: number;
}

// ==============================================================================
// RATE LIMITER
// ==============================================================================

export class RateLimiter {
  private config = getConfig();
  private logger = createLogger();
  private sessions = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  // Window size in milliseconds (1 minute)
  private readonly WINDOW_MS = 60_000;
  
  // Cleanup interval (every 5 minutes)
  private readonly CLEANUP_INTERVAL_MS = 5 * 60_000;
  
  constructor() {
    this.startCleanup();
  }
  
  /**
   * Check of request toegestaan is
   */
  checkLimit(sessionId: string): RateLimitInfo {
    const now = Date.now();
    const limit = this.config.rateLimitPerSession;
    
    // Get of create entry
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      entry = {
        requests: [],
        firstRequestAt: now
      };
      this.sessions.set(sessionId, entry);
    }
    
    // Remove oude requests buiten window
    entry.requests = entry.requests.filter(timestamp => 
      now - timestamp < this.WINDOW_MS
    );
    
    // Check limit
    const current = entry.requests.length;
    const allowed = current < limit;
    
    if (allowed) {
      // Add deze request
      entry.requests.push(now);
      
      this.logger.debug('Rate limit check passed', {
        session_id: sessionId,
        current: current + 1,
        limit
      });
      
      return {
        allowed: true,
        current: current + 1,
        limit,
        resetAt: now + this.WINDOW_MS
      };
    }
    
    // Rate limit exceeded
    const oldestRequest = Math.min(...entry.requests);
    const resetAt = oldestRequest + this.WINDOW_MS;
    const retryAfter = resetAt - now;
    
    this.logger.warn('Rate limit exceeded', {
      session_id: sessionId,
      current,
      limit,
      retry_after_ms: retryAfter
    });
    
    return {
      allowed: false,
      current,
      limit,
      resetAt,
      retryAfter
    };
  }
  
  /**
   * Enforce rate limit - throws error if exceeded
   */
  enforce(sessionId: string): void {
    const info = this.checkLimit(sessionId);
    
    if (!info.allowed) {
      throw new APIError(
        ErrorCode.API_RATE_LIMIT,
        `Rate limit exceeded. Maximum ${info.limit} requests per minute allowed.`,
        429,
        info.retryAfter
      );
    }
  }
  
  /**
   * Get huidige stats voor session
   */
  getStats(sessionId: string): RateLimitInfo | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    
    const now = Date.now();
    const validRequests = entry.requests.filter(timestamp => 
      now - timestamp < this.WINDOW_MS
    );
    
    return {
      allowed: validRequests.length < this.config.rateLimitPerSession,
      current: validRequests.length,
      limit: this.config.rateLimitPerSession,
      resetAt: now + this.WINDOW_MS
    };
  }
  
  /**
   * Reset limit voor session (voor testing)
   */
  reset(sessionId?: string): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
      this.logger.debug('Rate limit reset for session', { session_id: sessionId });
    } else {
      this.sessions.clear();
      this.logger.debug('All rate limits reset');
    }
  }
  
  /**
   * Cleanup oude sessions
   */
  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = now - (this.WINDOW_MS * 2); // 2 windows oud
    
    let removed = 0;
    for (const [sessionId, entry] of this.sessions.entries()) {
      if (entry.firstRequestAt < staleThreshold) {
        this.sessions.delete(sessionId);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.logger.debug('Cleaned up stale rate limit entries', {
        removed,
        remaining: this.sessions.size
      });
    }
  }
  
  /**
   * Start automatic cleanup
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;
    
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);
    
    // Allow process to exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
    
    this.logger.debug('Rate limiter cleanup started', {
      interval_ms: this.CLEANUP_INTERVAL_MS
    });
  }
  
  /**
   * Stop cleanup (voor testing)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.debug('Rate limiter cleanup stopped');
    }
  }
  
  /**
   * Get total stats
   */
  getTotalStats(): {
    totalSessions: number;
    totalRequests: number;
    limit: number;
  } {
    let totalRequests = 0;
    const now = Date.now();
    
    for (const entry of this.sessions.values()) {
      const validRequests = entry.requests.filter(timestamp => 
        now - timestamp < this.WINDOW_MS
      );
      totalRequests += validRequests.length;
    }
    
    return {
      totalSessions: this.sessions.size,
      totalRequests,
      limit: this.config.rateLimitPerSession
    };
  }
}

// ==============================================================================
// SINGLETON INSTANCE
// ==============================================================================

let limiterInstance: RateLimiter | null = null;

/**
 * Get rate limiter (singleton)
 */
export function getRateLimiter(): RateLimiter {
  if (!limiterInstance) {
    limiterInstance = new RateLimiter();
  }
  return limiterInstance;
}

/**
 * Reset rate limiter (voor testing)
 */
export function resetRateLimiter(): void {
  if (limiterInstance) {
    limiterInstance.stopCleanup();
  }
  limiterInstance = null;
}

/**
 * Helper functie om rate limiter te gebruiken in tool handlers
 */
export function enforceRateLimit(sessionId?: string): void {
  // Gebruik een default session ID als geen session_id gegeven
  const effectiveSessionId = sessionId || 'default';
  
  const limiter = getRateLimiter();
  limiter.enforce(effectiveSessionId);
}
