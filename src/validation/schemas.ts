/*
 * Runtime Validation Schemas met Zod (Fase 2)
 *
 * Dit bestand bevat Zod schemas en validation helpers voor runtime input
 * validatie. In Fase 2 handelen we validation errors als blocking errors:
 * validatiefouten worden direct gegooid als `ValidationError` zodat ze
 * door de caller kunnen worden afgehandeld.
 */

import { z } from 'zod';
import {
  ValidationConstraints,
  ErrorCode,
  ValidationError,
  calculateAge
} from '../types/index.js';

// ==============================================================================
// CUSTOM ZOD VALIDATORS
// ==============================================================================

const isoDateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Moet YYYY-MM-DD formaat zijn'
);

const euroAmountSchema = (min: number, max: number, fieldName?: string) => 
  z.number()
    .min(min, { message: `${fieldName || 'Bedrag'} moet minimaal €${min.toLocaleString('nl-NL')} zijn` })
    .max(max, { message: `${fieldName || 'Bedrag'} moet maximaal €${max.toLocaleString('nl-NL')} zijn` })
    .finite();

const positiveIntegerSchema = (min: number, max: number, fieldName?: string) => 
  z.number()
    .int()
    .min(min, { message: `${fieldName || 'Waarde'} moet minimaal ${min} zijn` })
    .max(max, { message: `${fieldName || 'Waarde'} moet maximaal ${max} zijn` });

// ==============================================================================
// VALIDATION FUNCTIONS
// ==============================================================================

/**
 * Valideer leeftijd op basis van geboortedatum
 */
export function validateAge(birthDate: string, field: string): void {
  // Check datum formaat
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw new ValidationError(
      ErrorCode.INVALID_DATE_FORMAT,
      `${field} moet YYYY-MM-DD formaat hebben`,
      `geboortedatum_${field}`,
      birthDate
    );
  }
  
  // Check of datum geldig is
  const date = new Date(birthDate);
  if (isNaN(date.getTime())) {
    throw new ValidationError(
      ErrorCode.INVALID_DATE_FORMAT,
      `${field} is geen geldige datum`,
      `geboortedatum_${field}`,
      birthDate
    );
  }
  
  // Check of datum niet in toekomst
  if (date > new Date()) {
    throw new ValidationError(
      ErrorCode.INVALID_DATE_FORMAT,
      `${field} mag niet in de toekomst liggen`,
      `geboortedatum_${field}`,
      birthDate
    );
  }
  
  // Check leeftijd
  const age = calculateAge(birthDate);
  if (age < ValidationConstraints.LEEFTIJD.MIN || age > ValidationConstraints.LEEFTIJD.MAX) {
    throw new ValidationError(
      ErrorCode.AGE_OUT_OF_RANGE,
      `${field} moet tussen ${ValidationConstraints.LEEFTIJD.MIN} en ${ValidationConstraints.LEEFTIJD.MAX} jaar oud zijn (nu: ${age} jaar)`,
      `geboortedatum_${field}`,
      birthDate
    );
  }
}

/**
 * Valideer base arguments (gebruikt door alle tools)
 */
export function validateBaseArguments(args: unknown): void {
  // Type check
  if (typeof args !== 'object' || args === null) {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'Arguments moet een object zijn',
      'arguments'
    );
  }

  const input = args as Record<string, unknown>;

  // Valideer verplichte velden
  if (typeof input.inkomen_aanvrager !== 'number') {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'inkomen_aanvrager moet een getal zijn',
      'inkomen_aanvrager',
      input.inkomen_aanvrager
    );
  }

  if (typeof input.geboortedatum_aanvrager !== 'string') {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'geboortedatum_aanvrager moet een string zijn',
      'geboortedatum_aanvrager',
      input.geboortedatum_aanvrager
    );
  }

  if (typeof input.heeft_partner !== 'boolean') {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'heeft_partner moet een boolean zijn',
      'heeft_partner',
      input.heeft_partner
    );
  }

  // Valideer inkomen range
  if (input.inkomen_aanvrager < ValidationConstraints.INKOMEN.MIN || 
      input.inkomen_aanvrager > ValidationConstraints.INKOMEN.MAX) {
    throw new ValidationError(
      ErrorCode.INCOME_OUT_OF_RANGE,
      `Inkomen aanvrager moet tussen €${ValidationConstraints.INKOMEN.MIN} en €${ValidationConstraints.INKOMEN.MAX} liggen`,
      'inkomen_aanvrager',
      input.inkomen_aanvrager
    );
  }

  // Valideer leeftijd aanvrager
  validateAge(input.geboortedatum_aanvrager, 'aanvrager');

  // Valideer partner gegevens indien heeft_partner = true
  if (input.heeft_partner) {
    if (input.inkomen_partner !== undefined) {
      if (typeof input.inkomen_partner !== 'number') {
        throw new ValidationError(
          ErrorCode.INVALID_INPUT,
          'inkomen_partner moet een getal zijn',
          'inkomen_partner',
          input.inkomen_partner
        );
      }

      if (input.inkomen_partner < ValidationConstraints.INKOMEN.MIN || 
          input.inkomen_partner > ValidationConstraints.INKOMEN.MAX) {
        throw new ValidationError(
          ErrorCode.INCOME_OUT_OF_RANGE,
          `Inkomen partner moet tussen €${ValidationConstraints.INKOMEN.MIN} en €${ValidationConstraints.INKOMEN.MAX} liggen`,
          'inkomen_partner',
          input.inkomen_partner
        );
      }
    }

    if (input.geboortedatum_partner) {
      if (typeof input.geboortedatum_partner !== 'string') {
        throw new ValidationError(
          ErrorCode.INVALID_INPUT,
          'geboortedatum_partner moet een string zijn',
          'geboortedatum_partner',
          input.geboortedatum_partner
        );
      }
      validateAge(input.geboortedatum_partner, 'partner');
    }
  }

  // Valideer verplichtingen
  if (input.verplichtingen_pm !== undefined) {
    if (typeof input.verplichtingen_pm !== 'number') {
      throw new ValidationError(
        ErrorCode.INVALID_INPUT,
        'verplichtingen_pm moet een getal zijn',
        'verplichtingen_pm',
        input.verplichtingen_pm
      );
    }

    if (input.verplichtingen_pm < ValidationConstraints.VERPLICHTINGEN.MIN || 
        input.verplichtingen_pm > ValidationConstraints.VERPLICHTINGEN.MAX) {
      throw new ValidationError(
        ErrorCode.INVALID_INPUT,
        `Verplichtingen moet tussen €${ValidationConstraints.VERPLICHTINGEN.MIN} en €${ValidationConstraints.VERPLICHTINGEN.MAX} liggen`,
        'verplichtingen_pm',
        input.verplichtingen_pm
      );
    }
  }
}

/**
 * Valideer leningdeel
 */
export function validateLeningdeel(leningdeel: unknown, index: number): void {
  if (typeof leningdeel !== 'object' || leningdeel === null) {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      `Leningdeel ${index} moet een object zijn`,
      `leningdelen[${index}]`
    );
  }
  
  const deel = leningdeel as Record<string, unknown>;
  
  // Check verplichte velden
  if (typeof deel.huidige_schuld !== 'number') {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      `Leningdeel ${index}: huidige_schuld moet een getal zijn`,
      `leningdelen[${index}].huidige_schuld`
    );
  }
  
  if (typeof deel.huidige_rente !== 'number') {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      `Leningdeel ${index}: huidige_rente moet een getal zijn (decimaal, bijv. 0.0372 voor 3.72%)`,
      `leningdelen[${index}].huidige_rente`
    );
  }
  
  if (typeof deel.resterende_looptijd_in_maanden !== 'number') {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      `Leningdeel ${index}: resterende_looptijd_in_maanden moet een getal zijn`,
      `leningdelen[${index}].resterende_looptijd_in_maanden`
    );
  }
  
  if (typeof deel.rentevasteperiode_maanden !== 'number') {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      `Leningdeel ${index}: rentevasteperiode_maanden moet een getal zijn`,
      `leningdelen[${index}].rentevasteperiode_maanden`
    );
  }
  
  // Valideer ranges
  if (deel.huidige_rente < ValidationConstraints.RENTE.MIN || 
      deel.huidige_rente > ValidationConstraints.RENTE.MAX) {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      `Leningdeel ${index}: huidige_rente moet tussen ${ValidationConstraints.RENTE.MIN} en ${ValidationConstraints.RENTE.MAX} liggen (0.0372 voor 3.72%)`,
      `leningdelen[${index}].huidige_rente`,
      deel.huidige_rente
    );
  }
  
  if (deel.resterende_looptijd_in_maanden < ValidationConstraints.LOOPTIJD.MIN_MAANDEN || 
      deel.resterende_looptijd_in_maanden > ValidationConstraints.LOOPTIJD.MAX_MAANDEN) {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      `Leningdeel ${index}: looptijd moet tussen ${ValidationConstraints.LOOPTIJD.MIN_MAANDEN} en ${ValidationConstraints.LOOPTIJD.MAX_MAANDEN} maanden liggen`,
      `leningdelen[${index}].resterende_looptijd_in_maanden`,
      deel.resterende_looptijd_in_maanden
    );
  }
  
  // Check rentevast <= looptijd
  if (deel.rentevasteperiode_maanden > deel.resterende_looptijd_in_maanden) {
    throw new ValidationError(
      ErrorCode.RENTEVAST_EXCEEDS_LOOPTIJD,
      `Leningdeel ${index}: rentevasteperiode (${deel.rentevasteperiode_maanden}) kan niet langer zijn dan resterende looptijd (${deel.resterende_looptijd_in_maanden})`,
      `leningdelen[${index}].rentevasteperiode_maanden`
    );
  }
}

/**
 * Valideer bestaande hypotheek
 */
export function validateBestaandeHypotheek(hypotheek: unknown): void {
  if (typeof hypotheek !== 'object' || hypotheek === null) {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'bestaande_hypotheek moet een object zijn',
      'bestaande_hypotheek'
    );
  }
  
  const hyp = hypotheek as Record<string, unknown>;
  
  if (!Array.isArray(hyp.leningdelen)) {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'bestaande_hypotheek.leningdelen moet een array zijn',
      'bestaande_hypotheek.leningdelen'
    );
  }
  
  if (hyp.leningdelen.length < ValidationConstraints.LENINGDELEN.MIN_COUNT) {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      `Minimaal ${ValidationConstraints.LENINGDELEN.MIN_COUNT} leningdeel vereist`,
      'bestaande_hypotheek.leningdelen'
    );
  }
  
  if (hyp.leningdelen.length > ValidationConstraints.LENINGDELEN.MAX_COUNT) {
    throw new ValidationError(
      ErrorCode.TOO_MANY_LENINGDELEN,
      `Maximaal ${ValidationConstraints.LENINGDELEN.MAX_COUNT} leningdelen toegestaan`,
      'bestaande_hypotheek.leningdelen',
      hyp.leningdelen.length
    );
  }
  
  // Valideer elk leningdeel
  hyp.leningdelen.forEach((deel, index) => {
    validateLeningdeel(deel, index);
  });
}

/**
 * Valideer doorstromer arguments
 */
export function validateDoorstromerArguments(args: unknown): void {
  // Eerst base arguments valideren
  validateBaseArguments(args);
  
  const input = args as Record<string, unknown>;
  
  // Valideer woningwaarde
  if (typeof input.waarde_huidige_woning !== 'number') {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'waarde_huidige_woning moet een getal zijn',
      'waarde_huidige_woning'
    );
  }
  
  if (input.waarde_huidige_woning < ValidationConstraints.WONING_WAARDE.MIN || 
      input.waarde_huidige_woning > ValidationConstraints.WONING_WAARDE.MAX) {
    throw new ValidationError(
      ErrorCode.WONING_VALUE_OUT_OF_RANGE,
      `Woningwaarde moet tussen €${ValidationConstraints.WONING_WAARDE.MIN.toLocaleString('nl-NL')} en €${ValidationConstraints.WONING_WAARDE.MAX.toLocaleString('nl-NL')} liggen`,
      'waarde_huidige_woning',
      input.waarde_huidige_woning
    );
  }
  
  // Valideer bestaande hypotheek
  if (!input.bestaande_hypotheek) {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'bestaande_hypotheek is verplicht voor doorstromers',
      'bestaande_hypotheek'
    );
  }
  
  validateBestaandeHypotheek(input.bestaande_hypotheek);
}
