/**
 * Metrics Exporter (Fase 3)
 * 
 * Exports metrics in Prometheus format for monitoring and alerting.
 */

import { getCircuitBreaker } from '../middleware/circuit-breaker.js';
import { getRateLimiter } from '../middleware/rate-limiter.js';
import { createLogger } from '../utils/logger.js';

// ==============================================================================
// TYPES
// ==============================================================================

export interface MetricValue {
  value: number;
  labels?: Record<string, string>;
  timestamp?: number;
}

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary'
}

export interface Metric {
  name: string;
  type: MetricType;
  help: string;
  values: MetricValue[];
}

// ==============================================================================
// METRICS REGISTRY
// ==============================================================================

export class MetricsRegistry {
  private logger = createLogger();
  private metrics = new Map<string, Metric>();
  private startTime = Date.now();
  
  /**
   * Register a new metric
   */
  register(name: string, type: MetricType, help: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        type,
        help,
        values: []
      });
    }
  }
  
  /**
   * Increment counter
   */
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== MetricType.COUNTER) {
      this.logger.warn('Counter not found or wrong type', { name });
      return;
    }
    
    // Find existing label combination or create new
    const existingValue = metric.values.find(v => 
      this.labelsMatch(v.labels, labels)
    );
    
    if (existingValue) {
      existingValue.value += value;
      existingValue.timestamp = Date.now();
    } else {
      metric.values.push({
        value,
        labels,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Set gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== MetricType.GAUGE) {
      this.logger.warn('Gauge not found or wrong type', { name });
      return;
    }
    
    // Find existing label combination or create new
    const existingValue = metric.values.find(v => 
      this.labelsMatch(v.labels, labels)
    );
    
    if (existingValue) {
      existingValue.value = value;
      existingValue.timestamp = Date.now();
    } else {
      metric.values.push({
        value,
        labels,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Observe histogram value
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== MetricType.HISTOGRAM) {
      this.logger.warn('Histogram not found or wrong type', { name });
      return;
    }
    
    // For simplicity, we store all observations
    // In production, you'd bucket these
    metric.values.push({
      value,
      labels,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get all metrics
   */
  getAll(): Metric[] {
    return Array.from(this.metrics.values());
  }
  
  /**
   * Get single metric
   */
  get(name: string): Metric | undefined {
    return this.metrics.get(name);
  }
  
  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.metrics.clear();
  }
  
  /**
   * Export to Prometheus format
   */
  export(): string {
    let output = '';
    
    for (const metric of this.metrics.values()) {
      // Help line
      output += `# HELP ${metric.name} ${metric.help}\n`;
      
      // Type line
      output += `# TYPE ${metric.name} ${metric.type}\n`;
      
      // Values
      for (const value of metric.values) {
        const labels = this.formatLabels(value.labels);
        output += `${metric.name}${labels} ${value.value}`;
        
        if (value.timestamp) {
          output += ` ${value.timestamp}`;
        }
        
        output += '\n';
      }
      
      output += '\n';
    }
    
    return output;
  }
  
  /**
   * Export to JSON format (alternative)
   */
  exportJSON(): Record<string, any> {
    const result: Record<string, any> = {
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      metrics: {}
    };
    
    for (const metric of this.metrics.values()) {
      result.metrics[metric.name] = {
        type: metric.type,
        help: metric.help,
        values: metric.values
      };
    }
    
    return result;
  }
  
  /**
   * Format labels for Prometheus
   */
  private formatLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }
    
    const pairs = Object.entries(labels)
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');
    
    return `{${pairs}}`;
  }
  
  /**
   * Check if labels match
   */
  private labelsMatch(a?: Record<string, string>, b?: Record<string, string>): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    
    if (keysA.length !== keysB.length) return false;
    
    for (let i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i]) return false;
      if (a[keysA[i]] !== b[keysB[i]]) return false;
    }
    
    return true;
  }
}

// ==============================================================================
// DEFAULT METRICS
// ==============================================================================

/**
 * Initialize standard metrics
 */
export function initializeMetrics(registry: MetricsRegistry): void {
  // Tool call metrics
  registry.register(
    'hypotheek_tool_calls_total',
    MetricType.COUNTER,
    'Total number of tool calls by tool name'
  );
  
  registry.register(
    'hypotheek_tool_duration_seconds',
    MetricType.HISTOGRAM,
    'Duration of tool calls in seconds'
  );
  
  registry.register(
    'hypotheek_tool_errors_total',
    MetricType.COUNTER,
    'Total number of tool call errors by error code'
  );
  
  // API metrics
  registry.register(
    'hypotheek_api_requests_total',
    MetricType.COUNTER,
    'Total number of API requests to Replit backend'
  );
  
  registry.register(
    'hypotheek_api_duration_seconds',
    MetricType.HISTOGRAM,
    'Duration of API requests in seconds'
  );
  
  registry.register(
    'hypotheek_api_errors_total',
    MetricType.COUNTER,
    'Total number of API errors by status code'
  );
  
  // Circuit breaker metrics
  registry.register(
    'hypotheek_circuit_breaker_state',
    MetricType.GAUGE,
    'Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)'
  );
  
  registry.register(
    'hypotheek_circuit_breaker_failures_total',
    MetricType.COUNTER,
    'Total number of circuit breaker failures'
  );
  
  // Rate limiter metrics
  registry.register(
    'hypotheek_rate_limit_hits_total',
    MetricType.COUNTER,
    'Total number of rate limit hits'
  );
  
  registry.register(
    'hypotheek_active_sessions',
    MetricType.GAUGE,
    'Number of active sessions'
  );
  
  // Validation metrics
  registry.register(
    'hypotheek_validation_errors_total',
    MetricType.COUNTER,
    'Total number of validation errors by error code'
  );
  
  // Process metrics
  registry.register(
    'hypotheek_process_uptime_seconds',
    MetricType.GAUGE,
    'Process uptime in seconds'
  );
}

// ==============================================================================
// METRICS COLLECTOR
// ==============================================================================

/**
 * Collect metrics from various components
 */
export class MetricsCollector {
  private registry: MetricsRegistry;
  private startTime = Date.now();
  
  constructor(registry: MetricsRegistry) {
    this.registry = registry;
  }
  
  /**
   * Collect all current metrics
   */
  collect(): void {
    this.collectCircuitBreakerMetrics();
    this.collectRateLimiterMetrics();
    this.collectProcessMetrics();
  }
  
  /**
   * Collect circuit breaker metrics
   */
  private collectCircuitBreakerMetrics(): void {
    try {
      const breaker = getCircuitBreaker();
      const stats = breaker.getStats();
      
      // Map state to number
      let stateValue = 0;
      if (stats.state === 'HALF_OPEN') stateValue = 1;
      if (stats.state === 'OPEN') stateValue = 2;
      
      this.registry.setGauge('hypotheek_circuit_breaker_state', stateValue);
      
      // Don't increment failures here - that's done when failures occur
    } catch (error) {
      // Circuit breaker not initialized yet
    }
  }
  
  /**
   * Collect rate limiter metrics
   */
  private collectRateLimiterMetrics(): void {
    try {
      const limiter = getRateLimiter();
      const stats = limiter.getTotalStats();
      
      this.registry.setGauge('hypotheek_active_sessions', stats.totalSessions);
    } catch (error) {
      // Rate limiter not initialized yet
    }
  }
  
  /**
   * Collect process metrics
   */
  private collectProcessMetrics(): void {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    this.registry.setGauge('hypotheek_process_uptime_seconds', uptime);
  }
}

// ==============================================================================
// SINGLETON INSTANCE
// ==============================================================================

let registryInstance: MetricsRegistry | null = null;
let collectorInstance: MetricsCollector | null = null;

/**
 * Get metrics registry (singleton)
 */
export function getMetricsRegistry(): MetricsRegistry {
  if (!registryInstance) {
    registryInstance = new MetricsRegistry();
    initializeMetrics(registryInstance);
  }
  return registryInstance;
}

/**
 * Get metrics collector (singleton)
 */
export function getMetricsCollector(): MetricsCollector {
  if (!collectorInstance) {
    const registry = getMetricsRegistry();
    collectorInstance = new MetricsCollector(registry);
  }
  return collectorInstance;
}

/**
 * Reset metrics (for testing)
 */
export function resetMetrics(): void {
  registryInstance = null;
  collectorInstance = null;
}

/**
 * Express-compatible metrics endpoint handler
 */
export function metricsHandler(req: any, res: any): void {
  const registry = getMetricsRegistry();
  const collector = getMetricsCollector();
  
  // Collect fresh metrics
  collector.collect();
  
  // Export in requested format
  const format = req.query.format || 'prometheus';
  
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(registry.exportJSON(), null, 2));
  } else {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(registry.export());
  }
}

/**
 * Record tool call metric
 */
export function recordToolCall(toolName: string, duration: number, success: boolean): void {
  const registry = getMetricsRegistry();
  
  registry.incrementCounter('hypotheek_tool_calls_total', 1, {
    tool: toolName,
    status: success ? 'success' : 'error'
  });
  
  registry.observeHistogram('hypotheek_tool_duration_seconds', duration / 1000, {
    tool: toolName
  });
}

/**
 * Record validation error metric
 */
export function recordValidationError(errorCode: string): void {
  const registry = getMetricsRegistry();
  
  registry.incrementCounter('hypotheek_validation_errors_total', 1, {
    error_code: errorCode
  });
}

/**
 * Record API call metric
 */
export function recordAPICall(duration: number, statusCode: number): void {
  const registry = getMetricsRegistry();
  
  registry.incrementCounter('hypotheek_api_requests_total', 1, {
    status: statusCode >= 200 && statusCode < 300 ? 'success' : 'error'
  });
  
  registry.observeHistogram('hypotheek_api_duration_seconds', duration / 1000);
  
  if (statusCode >= 400) {
    registry.incrementCounter('hypotheek_api_errors_total', 1, {
      status_code: statusCode.toString()
    });
  }
}
