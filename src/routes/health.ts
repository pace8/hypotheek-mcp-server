/**
 * Health Check Endpoint (Fase 3)
 * 
 * Provides comprehensive health status for monitoring and load balancers.
 */

import { getConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { getCircuitBreaker } from '../middleware/circuit-breaker.js';
import { getRateLimiter } from '../middleware/rate-limiter.js';

// ==============================================================================
// TYPES
// ==============================================================================

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy'
}

export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    api: ComponentHealth;
    circuitBreaker: ComponentHealth;
    rateLimiter: ComponentHealth;
    configuration: ComponentHealth;
  };
}

export interface ComponentHealth {
  status: HealthStatus;
  message?: string;
  details?: Record<string, unknown>;
}

// ==============================================================================
// HEALTH CHECKER
// ==============================================================================

export class HealthChecker {
  private logger = createLogger();
  private config = getConfig();
  private startTime = Date.now();
  
  /**
   * Perform full health check
   */
  async check(): Promise<HealthCheckResult> {
    const checks = {
      api: await this.checkAPI(),
      circuitBreaker: this.checkCircuitBreaker(),
      rateLimiter: this.checkRateLimiter(),
      configuration: this.checkConfiguration()
    };
    
    // Determine overall status
    const statuses = Object.values(checks).map(c => c.status);
    let overallStatus: HealthStatus;
    
    if (statuses.some(s => s === HealthStatus.UNHEALTHY)) {
      overallStatus = HealthStatus.UNHEALTHY;
    } else if (statuses.some(s => s === HealthStatus.DEGRADED)) {
      overallStatus = HealthStatus.DEGRADED;
    } else {
      overallStatus = HealthStatus.HEALTHY;
    }
    
    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: this.config.serverVersion,
      checks
    };
    
    this.logger.debug('Health check completed', {
      status: overallStatus,
      uptime: result.uptime
    });
    
    return result;
  }
  
  /**
   * Check API connectivity to Replit backend
   */
  private async checkAPI(): Promise<ComponentHealth> {
    try {
      // Simple connectivity check (ping rentes endpoint met timeout)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(this.config.replitApiUrlRentes, {
        method: 'HEAD',
        headers: {
          'Authorization': `Bearer ${this.config.replitApiKey}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return {
          status: HealthStatus.HEALTHY,
          message: 'API accessible',
          details: {
            url: this.config.replitApiUrlBase,
            response_time_ms: 0 // Could measure this
          }
        };
      } else {
        return {
          status: HealthStatus.DEGRADED,
          message: `API returned ${response.status}`,
          details: {
            status_code: response.status
          }
        };
      }
      
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'API unreachable',
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
  
  /**
   * Check circuit breaker status
   */
  private checkCircuitBreaker(): ComponentHealth {
    try {
      const breaker = getCircuitBreaker();
      const stats = breaker.getStats();
      
      if (stats.state === 'OPEN') {
        return {
          status: HealthStatus.UNHEALTHY,
          message: 'Circuit breaker is OPEN',
          details: {
            state: stats.state,
            failures: stats.failures,
            next_attempt_at: stats.nextAttemptAt 
              ? new Date(stats.nextAttemptAt).toISOString() 
              : undefined
          }
        };
      }
      
      if (stats.state === 'HALF_OPEN') {
        return {
          status: HealthStatus.DEGRADED,
          message: 'Circuit breaker is HALF_OPEN (testing)',
          details: {
            state: stats.state,
            failures: stats.failures
          }
        };
      }
      
      return {
        status: HealthStatus.HEALTHY,
        message: 'Circuit breaker operational',
        details: {
          state: stats.state,
          failures: stats.failures,
          successes: stats.successes
        }
      };
      
    } catch (error) {
      return {
        status: HealthStatus.DEGRADED,
        message: 'Circuit breaker check failed',
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
  
  /**
   * Check rate limiter status
   */
  private checkRateLimiter(): ComponentHealth {
    try {
      const limiter = getRateLimiter();
      const stats = limiter.getTotalStats();
      
      // Check if rate limiting is causing issues
      const utilizationPct = (stats.totalRequests / (stats.totalSessions * stats.limit)) * 100;
      
      if (utilizationPct > 90) {
        return {
          status: HealthStatus.DEGRADED,
          message: 'Rate limiter under heavy load',
          details: {
            total_sessions: stats.totalSessions,
            total_requests: stats.totalRequests,
            utilization_pct: Math.round(utilizationPct)
          }
        };
      }
      
      return {
        status: HealthStatus.HEALTHY,
        message: 'Rate limiter operational',
        details: {
          total_sessions: stats.totalSessions,
          total_requests: stats.totalRequests,
          limit_per_session: stats.limit
        }
      };
      
    } catch (error) {
      return {
        status: HealthStatus.DEGRADED,
        message: 'Rate limiter check failed',
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
  
  /**
   * Check configuration
   */
  private checkConfiguration(): ComponentHealth {
    const issues: string[] = [];
    
    // Check required config
    if (!this.config.replitApiKey || this.config.replitApiKey === 'test-replit-api-key') {
      issues.push('API key not configured');
    }
    
    if (!this.config.replitApiUrlBase) {
      issues.push('API URL not configured');
    }
    
    if (issues.length > 0) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'Configuration issues detected',
        details: { issues }
      };
    }
    
    return {
      status: HealthStatus.HEALTHY,
      message: 'Configuration valid',
      details: {
        log_level: this.config.logLevel,
        environment: this.config.nodeEnv,
        api_timeout_ms: this.config.apiTimeoutMs
      }
    };
  }
  
  /**
   * Simple readiness check (faster than full health check)
   */
  async isReady(): Promise<boolean> {
    // Just check if circuit breaker is not open
    try {
      const breaker = getCircuitBreaker();
      const stats = breaker.getStats();
      return stats.state !== 'OPEN';
    } catch {
      return false;
    }
  }
  
  /**
   * Simple liveness check (even faster - just process alive)
   */
  isAlive(): boolean {
    return true;
  }
}

// ==============================================================================
// SINGLETON INSTANCE
// ==============================================================================

let checkerInstance: HealthChecker | null = null;

/**
 * Get health checker (singleton)
 */
export function getHealthChecker(): HealthChecker {
  if (!checkerInstance) {
    checkerInstance = new HealthChecker();
  }
  return checkerInstance;
}

/**
 * Reset health checker (for testing)
 */
export function resetHealthChecker(): void {
  checkerInstance = null;
}

/**
 * Express-compatible health endpoint handler
 * (Not used in MCP stdio mode, but useful if deployed with HTTP transport)
 */
export async function healthHandler(req: any, res: any): Promise<void> {
  const checker = getHealthChecker();
  const result = await checker.check();
  
  const statusCode = result.status === HealthStatus.HEALTHY ? 200 :
                     result.status === HealthStatus.DEGRADED ? 200 :
                     503;
  
  res.status(statusCode).json(result);
}

/**
 * Readiness probe handler (for Kubernetes)
 */
export async function readinessHandler(req: any, res: any): Promise<void> {
  const checker = getHealthChecker();
  const ready = await checker.isReady();
  
  if (ready) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not_ready' });
  }
}

/**
 * Liveness probe handler (for Kubernetes)
 */
export function livenessHandler(req: any, res: any): void {
  const checker = getHealthChecker();
  const alive = checker.isAlive();
  
  if (alive) {
    res.status(200).json({ status: 'alive' });
  } else {
    res.status(503).json({ status: 'dead' });
  }
}
