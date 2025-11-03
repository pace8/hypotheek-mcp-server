/**
 * PII Scrubber (Fase 3)
 * 
 * Removes Personally Identifiable Information from logs to comply with GDPR
 * and other privacy regulations.
 */

import { createLogger } from './logger.js';

// ==============================================================================
// PII PATTERNS
// ==============================================================================

/**
 * Velden die altijd als PII beschouwd worden
 */
const PII_FIELDS = [
  'geboortedatum_aanvrager',
  'geboortedatum_partner',
  'inkomen_aanvrager',
  'inkomen_partner',
  'email',
  'naam',
  'name',
  'adres',
  'address',
  'postcode',
  'postal_code',
  'telefoonnummer',
  'phone',
  'iban',
  'bsn',
  'kvk',
  'password',
  'wachtwoord',
  'token',
  'api_key'
];

/**
 * Patronen die mogelijk PII bevatten
 */
const PII_PATTERNS = [
  // Email pattern
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
  
  // Phone numbers (NL format)
  /\b(\+31|0031|0)[-\s]?[1-9](\s?[0-9]){8}\b/g,
  
  // IBAN (simplified)
  /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
  
  // BSN (9 cijfers)
  /\b\d{9}\b/g,
  
  // Date patterns (kunnen geboortedatum zijn)
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{2}-\d{2}-\d{4}\b/g,
  /\b\d{2}\/\d{2}\/\d{4}\b/g
];

// ==============================================================================
// SCRUBBING FUNCTIONS
// ==============================================================================

/**
 * Scrub PII from any value
 */
export function scrubPII(value: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return '[DEPTH_LIMIT]';
  }
  
  // Null/undefined
  if (value === null || value === undefined) {
    return value;
  }
  
  // String - check for patterns
  if (typeof value === 'string') {
    return scrubString(value);
  }
  
  // Number - could be income, leave as-is but could aggregate
  if (typeof value === 'number') {
    // In production, we might want to round income to brackets
    return value;
  }
  
  // Boolean
  if (typeof value === 'boolean') {
    return value;
  }
  
  // Array
  if (Array.isArray(value)) {
    return value.map(item => scrubPII(item, depth + 1));
  }
  
  // Object
  if (typeof value === 'object') {
    return scrubObject(value as Record<string, unknown>, depth);
  }
  
  return value;
}

/**
 * Scrub PII from object
 */
function scrubObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // Check if key is known PII field
    if (PII_FIELDS.some(piiField => lowerKey.includes(piiField.toLowerCase()))) {
      scrubbed[key] = '[REDACTED]';
      continue;
    }
    
    // Recursively scrub value
    scrubbed[key] = scrubPII(value, depth + 1);
  }
  
  return scrubbed;
}

/**
 * Scrub PII patterns from string
 */
function scrubString(str: string): string {
  let scrubbed = str;
  
  // Apply all patterns
  for (const pattern of PII_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  
  return scrubbed;
}

/**
 * Aggregate numeric PII into brackets (for analytics without exposing exact values)
 */
export function aggregateIncome(income: number): string {
  if (income < 20000) return '<20K';
  if (income < 30000) return '20-30K';
  if (income < 40000) return '30-40K';
  if (income < 50000) return '40-50K';
  if (income < 60000) return '50-60K';
  if (income < 75000) return '60-75K';
  if (income < 100000) return '75-100K';
  if (income < 150000) return '100-150K';
  return '>150K';
}

/**
 * Aggregate age into brackets
 */
export function aggregateAge(birthDate: string): string {
  try {
    const birth = new Date(birthDate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
      age--;
    }
    
    if (age < 25) return '<25';
    if (age < 35) return '25-34';
    if (age < 45) return '35-44';
    if (age < 55) return '45-54';
    if (age < 65) return '55-64';
    return '65+';
  } catch {
    return 'unknown';
  }
}

/**
 * Create safe log context (aggregate PII for analytics)
 */
export function createSafeLogContext(args: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  
  // Session ID is OK (UUID, not PII)
  if (args.session_id) {
    safe.session_id = args.session_id;
  }
  
  // Aggregate income instead of exact value
  if (typeof args.inkomen_aanvrager === 'number') {
    safe.inkomen_bracket_aanvrager = aggregateIncome(args.inkomen_aanvrager);
  }
  
  if (typeof args.inkomen_partner === 'number') {
    safe.inkomen_bracket_partner = aggregateIncome(args.inkomen_partner);
  }
  
  // Aggregate age instead of birth date
  if (typeof args.geboortedatum_aanvrager === 'string') {
    safe.leeftijd_bracket_aanvrager = aggregateAge(args.geboortedatum_aanvrager);
  }
  
  if (typeof args.geboortedatum_partner === 'string') {
    safe.leeftijd_bracket_partner = aggregateAge(args.geboortedatum_partner);
  }
  
  // Boolean flags are OK
  if (typeof args.heeft_partner === 'boolean') {
    safe.heeft_partner = args.heeft_partner;
  }
  
  // Aggregate verplichtingen
  if (typeof args.verplichtingen_pm === 'number') {
    if (args.verplichtingen_pm === 0) {
      safe.heeft_verplichtingen = false;
    } else if (args.verplichtingen_pm < 500) {
      safe.verplichtingen_bracket = '<500';
    } else if (args.verplichtingen_pm < 1000) {
      safe.verplichtingen_bracket = '500-1000';
    } else {
      safe.verplichtingen_bracket = '>1000';
    }
  }
  
  // Woningwaarde brackets
  if (typeof args.waarde_huidige_woning === 'number') {
    const value = args.waarde_huidige_woning;
    if (value < 200000) safe.woningwaarde_bracket = '<200K';
    else if (value < 300000) safe.woningwaarde_bracket = '200-300K';
    else if (value < 400000) safe.woningwaarde_bracket = '300-400K';
    else if (value < 500000) safe.woningwaarde_bracket = '400-500K';
    else safe.woningwaarde_bracket = '>500K';
  }
  
  // Count leningdelen zonder details
  if (args.bestaande_hypotheek && typeof args.bestaande_hypotheek === 'object') {
    const hyp = args.bestaande_hypotheek as Record<string, unknown>;
    if (Array.isArray(hyp.leningdelen)) {
      safe.aantal_leningdelen = hyp.leningdelen.length;
    }
  }
  
  return safe;
}

/**
 * Check if value contains potential PII
 */
export function containsPII(value: unknown): boolean {
  if (typeof value === 'string') {
    return PII_PATTERNS.some(pattern => pattern.test(value));
  }
  
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      if (PII_FIELDS.some(piiField => 
        key.toLowerCase().includes(piiField.toLowerCase())
      )) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Validate that logs don't contain PII (for testing)
 */
export function assertNoPII(logMessage: string, context?: Record<string, unknown>): void {
  const logger = createLogger();
  
  // Check message
  if (containsPII(logMessage)) {
    logger.error('PII detected in log message', undefined, {
      message: '[REDACTED - PII detected]'
    });
    throw new Error('PII detected in log message');
  }
  
  // Check context
  if (context && containsPII(context)) {
    logger.error('PII detected in log context', undefined, {
      context: '[REDACTED - PII detected]'
    });
    throw new Error('PII detected in log context');
  }
}

// ==============================================================================
// REDACTION PRESETS
// ==============================================================================

/**
 * Different redaction levels based on environment
 */
export enum RedactionLevel {
  NONE = 'none',           // Development - no redaction
  PARTIAL = 'partial',     // Staging - aggregate PII
  FULL = 'full'           // Production - full redaction
}

/**
 * Apply redaction based on environment
 */
export function applyRedaction(
  data: Record<string, unknown>,
  level?: RedactionLevel
): Record<string, unknown> {
  const effectiveLevel = level || getRedactionLevel();
  
  switch (effectiveLevel) {
    case RedactionLevel.NONE:
      return data;
      
    case RedactionLevel.PARTIAL:
      return createSafeLogContext(data);
      
    case RedactionLevel.FULL:
      return scrubPII(data) as Record<string, unknown>;
      
    default:
      return scrubPII(data) as Record<string, unknown>;
  }
}

/**
 * Get redaction level from environment
 */
function getRedactionLevel(): RedactionLevel {
  const env = process.env.NODE_ENV || 'development';
  const level = process.env.PII_REDACTION_LEVEL;
  
  if (level) {
    return level as RedactionLevel;
  }
  
  // Default based on environment
  if (env === 'production') {
    return RedactionLevel.FULL;
  } else if (env === 'staging') {
    return RedactionLevel.PARTIAL;
  } else {
    return RedactionLevel.NONE;
  }
}
