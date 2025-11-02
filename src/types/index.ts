/**
 * Hypotheek MCP Server v4 - Strict Type Definitions (Fase 1)
 * 
 * Dit bestand bevat alle type definities met strikte validatie constraints,
 * enums voor alle variabelen, en error codes.
 */

// ==============================================================================
// ENUMS
// ==============================================================================

/**
 * Hypotheekvorm enum met alle ondersteunde varianten
 */
export enum Hypotheekvorm {
  ANNUITEIT = 'annuiteit',
  LINEAIR = 'lineair',
  AFLOSSINGSVRIJ = 'aflossingsvrij'
}

/**
 * Energielabel enum volgens Nederlandse EPA-schaal
 */
export enum Energielabel {
  A_PLUS_PLUS_PLUS_PLUS_GARANTIE = 'A++++ (met garantie)',
  A_PLUS_PLUS_PLUS_PLUS = 'A++++',
  A_PLUS_PLUS_PLUS = 'A+++',
  A_PLUS_PLUS = 'A++',
  A_PLUS = 'A+',
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  E = 'E',
  F = 'F',
  G = 'G'
}

/**
 * Error codes voor machine-leesbare error handling
 */
export enum ErrorCode {
  // Input validation errors (4xx equivalent)
  INVALID_INPUT = 'INVALID_INPUT',
  INVALID_DATE_FORMAT = 'INVALID_DATE_FORMAT',
  AGE_OUT_OF_RANGE = 'AGE_OUT_OF_RANGE',
  INCOME_OUT_OF_RANGE = 'INCOME_OUT_OF_RANGE',
  RENTEVAST_EXCEEDS_LOOPTIJD = 'RENTEVAST_EXCEEDS_LOOPTIJD',
  TOO_MANY_LENINGDELEN = 'TOO_MANY_LENINGDELEN',
  WONING_VALUE_OUT_OF_RANGE = 'WONING_VALUE_OUT_OF_RANGE',
  INVALID_HYPOTHEEKVORM = 'INVALID_HYPOTHEEKVORM',
  INVALID_ENERGIELABEL = 'INVALID_ENERGIELABEL',
  PARTNER_DATA_INCOMPLETE = 'PARTNER_DATA_INCOMPLETE',
  
  // API/Backend errors (5xx equivalent)
  API_ERROR = 'API_ERROR',
  API_TIMEOUT = 'API_TIMEOUT',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  
  // System errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR'
}

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

// ==============================================================================
// VALIDATION CONSTRAINTS
// ==============================================================================

export const ValidationConstraints = {
  INKOMEN: {
    MIN: 0,
    MAX: 1_000_000,
  },
  LEEFTIJD: {
    MIN: 18,
    MAX: 75,
  },
  WONING_WAARDE: {
    MIN: 50_000,
    MAX: 5_000_000,
  },
  RENTE: {
    MIN: 0.0,
    MAX: 0.20, // 20%
  },
  LOOPTIJD: {
    MIN_MAANDEN: 1,
    MAX_MAANDEN: 360, // 30 jaar
  },
  RENTEVAST: {
    MIN_MAANDEN: 0,
    MAX_MAANDEN: 360,
  },
  LENINGDELEN: {
    MIN_COUNT: 1,
    MAX_COUNT: 10,
  },
  VERPLICHTINGEN: {
    MIN: 0,
    MAX: 50_000,
  },
} as const;

// ==============================================================================
// ERROR TYPES
// ==============================================================================

/**
 * Structured error response
 */
export interface StructuredError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retry_after_ms?: number;
  correlation_id?: string;
  field?: string;
  suggestion?: string;
}

/**
 * Validation error class
 */
export class ValidationError extends Error {
  public readonly code: ErrorCode;
  public readonly field?: string;
  public readonly value?: unknown;
  
  constructor(
    code: ErrorCode,
    message: string,
    field?: string,
    value?: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.field = field;
    this.value = value;
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }
  
  toStructured(correlationId?: string): StructuredError {
    return {
      code: this.code,
      message: this.message,
      field: this.field,
      details: this.value ? { value: this.value } : undefined,
      correlation_id: correlationId,
      suggestion: this.getSuggestion()
    };
  }
  
  private getSuggestion(): string | undefined {
    switch (this.code) {
      case ErrorCode.INVALID_DATE_FORMAT:
        return 'Gebruik formaat YYYY-MM-DD (bijvoorbeeld: 1990-05-15)';
      case ErrorCode.AGE_OUT_OF_RANGE:
        return `Leeftijd moet tussen ${ValidationConstraints.LEEFTIJD.MIN} en ${ValidationConstraints.LEEFTIJD.MAX} jaar zijn`;
      case ErrorCode.INCOME_OUT_OF_RANGE:
        return `Inkomen moet tussen €${ValidationConstraints.INKOMEN.MIN} en €${ValidationConstraints.INKOMEN.MAX} zijn`;
      default:
        return undefined;
    }
  }
}

/**
 * API error class
 */
export class APIError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode?: number;
  public readonly retryAfterMs?: number;
  
  constructor(
    code: ErrorCode,
    message: string,
    statusCode?: number,
    retryAfterMs?: number
  ) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, APIError);
    }
  }
  
  toStructured(correlationId?: string): StructuredError {
    return {
      code: this.code,
      message: this.message,
      retry_after_ms: this.retryAfterMs,
      correlation_id: correlationId,
      details: this.statusCode ? { status_code: this.statusCode } : undefined
    };
  }
  
  isRetryable(): boolean {
    return [
      ErrorCode.API_ERROR,
      ErrorCode.API_TIMEOUT,
      ErrorCode.API_RATE_LIMIT
    ].includes(this.code);
  }
}

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

/**
 * Bereken leeftijd op basis van geboortedatum
 */
export function calculateAge(birthDate: string, referenceDate: Date = new Date()): number {
  const birth = new Date(birthDate);
  let age = referenceDate.getFullYear() - birth.getFullYear();
  const monthDiff = referenceDate.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < birth.getDate())) {
    age--;
  }
  
  return age;
}

/**
 * Type guard voor Hypotheekvorm
 */
export function isHypotheekvorm(value: unknown): value is Hypotheekvorm {
  return Object.values(Hypotheekvorm).includes(value as Hypotheekvorm);
}

/**
 * Type guard voor Energielabel
 */
export function isEnergielabel(value: unknown): value is Energielabel {
  return Object.values(Energielabel).includes(value as Energielabel);
}

/**
 * Normaliseer hypotheekvorm string naar enum
 */
export function normalizeHypotheekvorm(value: string): Hypotheekvorm {
  const normalized = value.toLowerCase().trim();
  
  const mapping: Record<string, Hypotheekvorm> = {
    'annuiteit': Hypotheekvorm.ANNUITEIT,
    'lineair': Hypotheekvorm.LINEAIR,
    'aflossingsvrij': Hypotheekvorm.AFLOSSINGSVRIJ,
    'aflossings vrij': Hypotheekvorm.AFLOSSINGSVRIJ,
  };
  
  const result = mapping[normalized];
  if (!result) {
    throw new ValidationError(
      ErrorCode.INVALID_HYPOTHEEKVORM,
      `Ongeldige hypotheekvorm: ${value}. Toegestaan: annuiteit, lineair, aflossingsvrij`,
      'hypotheekvorm',
      value
    );
  }
  
  return result;
}

/**
 * Normaliseer energielabel
 */
export function normalizeEnergielabel(value: string): Energielabel {
  // Direct match proberen
  if (isEnergielabel(value)) {
    return value as Energielabel;
  }
  
  // Fallback naar oude implementatie voor backwards compatibility
  const labelMap: Record<string, Energielabel> = {
    'A++++': Energielabel.A_PLUS_PLUS_PLUS_PLUS,
    'A++++ (met garantie)': Energielabel.A_PLUS_PLUS_PLUS_PLUS_GARANTIE,
    'A+++': Energielabel.A_PLUS_PLUS_PLUS,
    'A++': Energielabel.A_PLUS_PLUS,
    'A+': Energielabel.A_PLUS,
    'A': Energielabel.A,
    'B': Energielabel.B,
    'C': Energielabel.C,
    'D': Energielabel.D,
    'E': Energielabel.E,
    'F': Energielabel.F,
    'G': Energielabel.G,
  };
  
  const result = labelMap[value];
  if (!result) {
    throw new ValidationError(
      ErrorCode.INVALID_ENERGIELABEL,
      `Ongeldig energielabel: ${value}`,
      'energielabel',
      value
    );
  }
  
  return result;
}
