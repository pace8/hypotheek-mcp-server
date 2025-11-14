/**
 * Field Normalization Layer
 * 
 * Normaliseert verschillende veldnaam varianten naar canonical format.
 * Dit maakt het systeem tolerant voor LLM variaties (Engels/Nederlands, typos).
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger();

// ==============================================================================
// MAPPING DICTIONARIES
// ==============================================================================

const LENINGDEEL_FIELD_MAPPINGS: Record<string, string> = {
  'huidige_schuld': 'huidige_schuld',
  'principal': 'huidige_schuld',
  'restschuld': 'huidige_schuld',
  'remaining_principal': 'huidige_schuld',
  'schuld': 'huidige_schuld',
  'loan_amount': 'huidige_schuld',
  
  'huidige_rente': 'huidige_rente',
  'contract_rate': 'huidige_rente',
  'interest_rate': 'huidige_rente',
  'rente': 'huidige_rente',
  'rate': 'huidige_rente',
  
  'resterende_looptijd_in_maanden': 'resterende_looptijd_in_maanden',
  'term_months': 'resterende_looptijd_in_maanden',
  'remaining_term_months': 'resterende_looptijd_in_maanden',
  'looptijd_maanden': 'resterende_looptijd_in_maanden',
  'remaining_term': 'resterende_looptijd_in_maanden',
  
  'rentevasteperiode_maanden': 'rentevasteperiode_maanden',
  'rvp_months': 'rentevasteperiode_maanden',
  'fixed_rate_period_months': 'rentevasteperiode_maanden',
  'rentevast_maanden': 'rentevasteperiode_maanden',
  'fixed_period': 'rentevasteperiode_maanden',
  
  'hypotheekvorm': 'hypotheekvorm',
  'loan_type': 'hypotheekvorm',
  'mortgage_type': 'hypotheekvorm',
  'type': 'hypotheekvorm',
};

const BESTAANDE_HYPOTHEEK_MAPPINGS: Record<string, string> = {
  'bestaande_hypotheek': 'bestaande_hypotheek',
  'bestaande_lening': 'bestaande_hypotheek',
  'existing_mortgage': 'bestaande_hypotheek',
  'current_mortgage': 'bestaande_hypotheek',
  'existing_loan': 'bestaande_hypotheek',

  'leningdelen': 'leningdelen',
  'existing_loan_parts': 'leningdelen',
  'loan_parts': 'leningdelen',
  'bestaande_leningdelen': 'leningdelen',
  'parts': 'leningdelen',

  'waarde_huidige_woning': 'waarde_huidige_woning',
  'current_home_value': 'waarde_huidige_woning',
  'huidige_woningwaarde': 'waarde_huidige_woning',
  'home_value': 'waarde_huidige_woning',
};

// ==============================================================================
// NORMALIZATION FUNCTIONS
// ==============================================================================

export function normalizeLeningdeel(input: any, index: number): any {
  if (!input || typeof input !== 'object') {
    logger.warn('Invalid leningdeel input', { index, input });
    return input;
  }
  
  const normalized: any = {};
  const unknownFields: string[] = [];
  
  for (const [key, value] of Object.entries(input)) {
    const lowerKey = key.toLowerCase().trim();
    const canonicalKey = LENINGDEEL_FIELD_MAPPINGS[lowerKey];
    
    if (canonicalKey) {
      normalized[canonicalKey] = value;
    } else {
      normalized[key] = value;
      unknownFields.push(key);
    }
  }
  
  if (unknownFields.length > 0) {
    logger.warn('Unknown leningdeel fields detected', {
      index,
      unknown_fields: unknownFields,
      hint: 'These fields will be kept but may cause validation errors'
    });
  }
  
  return normalized;
}

export function normalizeBestaandeHypotheek(input: any): any {
  if (!input || typeof input !== 'object') {
    logger.warn('Invalid bestaande_hypotheek input', { input });
    return input;
  }
  
  const normalized: any = {};
  
  for (const [key, value] of Object.entries(input)) {
    const lowerKey = key.toLowerCase().trim();
    
    const isLeningdelenArray = 
      (lowerKey.includes('lening') && lowerKey.includes('deel')) ||
      (lowerKey.includes('loan') && lowerKey.includes('part')) ||
      lowerKey === 'parts';
    
    if (isLeningdelenArray && Array.isArray(value)) {
      normalized.leningdelen = value.map((deel, idx) => normalizeLeningdeel(deel, idx));
    } else {
      const canonicalKey = BESTAANDE_HYPOTHEEK_MAPPINGS[lowerKey];
      
      if (canonicalKey) {
        normalized[canonicalKey] = value;
      } else {
        normalized[key] = value;
        logger.debug('Unknown field in bestaande_hypotheek', { field: key });
      }
    }
  }
  
  return normalized;
}

export function normalizeDoorstromerArgs(args: any): any {
  if (!args || typeof args !== 'object') {
    logger.warn('Invalid doorstromer args input', { args });
    return args;
  }
  
  const normalized: any = { ...args };
  
  for (const key of Object.keys(normalized)) {
    const lowerKey = key.toLowerCase().trim();
    
    const isBestaandeHypotheek = 
      (lowerKey.includes('bestaande') || lowerKey.includes('existing') || lowerKey.includes('current')) &&
      (lowerKey.includes('hypotheek') || lowerKey.includes('lening') || lowerKey.includes('mortgage') || lowerKey.includes('loan'));
    
    if (isBestaandeHypotheek) {
      logger.debug('Normalizing bestaande_hypotheek', { original_key: key });
      normalized.bestaande_hypotheek = normalizeBestaandeHypotheek(normalized[key]);
      
      if (key !== 'bestaande_hypotheek') {
        delete normalized[key];
      }
    }
    
    const isWoningwaarde = 
      (lowerKey.includes('waarde') && lowerKey.includes('woning')) ||
      (lowerKey.includes('home') && lowerKey.includes('value'));
    
    if (isWoningwaarde && typeof normalized[key] === 'number') {
      logger.debug('Normalizing waarde_huidige_woning', { original_key: key });
      normalized.waarde_huidige_woning = normalized[key];
      
      if (key !== 'waarde_huidige_woning') {
        delete normalized[key];
      }
    }
  }
  
  logger.info('Normalization complete', {
    has_bestaande_hypotheek: !!normalized.bestaande_hypotheek,
    has_leningdelen: !!normalized.bestaande_hypotheek?.leningdelen,
    leningdelen_count: normalized.bestaande_hypotheek?.leningdelen?.length || 0
  });
  
  return normalized;
}

export function normalizeOpzetAanvragerShape(args: any): any {
  if (!args || typeof args !== 'object') {
    return args;
  }

  if (args.aanvrager && typeof args.aanvrager === 'object') {
    return args;
  }

  const legacy = { ...args };
  if (
    typeof legacy.inkomen_aanvrager === 'number' &&
    typeof legacy.geboortedatum_aanvrager === 'string' &&
    typeof legacy.heeft_partner === 'boolean'
  ) {
    legacy.aanvrager = {
      inkomen_aanvrager: legacy.inkomen_aanvrager,
      geboortedatum_aanvrager: legacy.geboortedatum_aanvrager,
      heeft_partner: legacy.heeft_partner,
      inkomen_partner: legacy.inkomen_partner,
      geboortedatum_partner: legacy.geboortedatum_partner,
      verplichtingen_pm: legacy.verplichtingen_pm,
      eigen_vermogen: legacy.eigen_vermogen,
    };
  }

  return legacy;
}

export function normalizeOpzetDoorstromerArgs(args: any): any {
  const normalized = normalizeOpzetAanvragerShape(args);
  if (normalized?.bestaande_hypotheek) {
    normalized.bestaande_hypotheek = normalizeBestaandeHypotheek(normalized.bestaande_hypotheek);
  }
  return normalized;
}
