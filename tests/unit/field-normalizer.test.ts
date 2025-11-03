import { describe, it, expect } from '@jest/globals';
import {
  normalizeDoorstromerArgs,
  normalizeLeningdeel,
  normalizeBestaandeHypotheek
} from '../../src/adapters/field-normalizer';

describe('Field Normalizer', () => {
  it('should normalize doorstromer args with English variant keys', () => {
    const input = {
      existing_mortgage: {
        loan_parts: [
          {
            Principal: 100000,
            Interest_Rate: 0.03,
            Remaining_Term_Months: 120,
            Fixed_rate_period_months: 60,
            loan_type: 'annuiteit'
          }
        ]
      },
      home_value: 250000
    } as any;

    const normalized = normalizeDoorstromerArgs(input);

    expect(normalized).toHaveProperty('bestaande_hypotheek');
    expect(normalized.bestaande_hypotheek).toHaveProperty('leningdelen');
    expect(Array.isArray(normalized.bestaande_hypotheek.leningdelen)).toBe(true);
    const deel = normalized.bestaande_hypotheek.leningdelen[0];
    expect(deel).toHaveProperty('huidige_schuld', 100000);
    expect(deel).toHaveProperty('huidige_rente', 0.03);
    expect(deel).toHaveProperty('resterende_looptijd_in_maanden', 120);
    expect(deel).toHaveProperty('rentevasteperiode_maanden', 60);
    expect(deel).toHaveProperty('hypotheekvorm', 'annuiteit');
  });

  it('should normalize leningdeel field name variants', () => {
    const input = {
      Principal: 123456,
      Rate: 0.05,
      Term_Months: 180,
      Fixed_period: 24,
      Loan_Type: 'aflossingsvrij',
      some_unknown_field: 'keep-me'
    } as any;

    const normalized = normalizeLeningdeel(input, 0);

    expect(normalized.huidige_schuld).toBe(123456);
    expect(normalized.huidige_rente).toBe(0.05);
    expect(normalized.resterende_looptijd_in_maanden).toBe(180);
    expect(normalized.rentevasteperiode_maanden).toBe(24);
    expect(normalized.hypotheekvorm).toBe('aflossingsvrij');
    // unknown fields are preserved
    expect(normalized).toHaveProperty('some_unknown_field', 'keep-me');
  });

  it('should normalize bestaande_hypotheek top-level fields', () => {
    const input = {
      Bestaande_Lening: {
        parts: [
          { principal: 50000, rate: 0.02, term_months: 120, rvp_months: 0, hypotheekvorm: 'annuiteit' }
        ]
      }
    } as any;

    const normalized = normalizeBestaandeHypotheek(input.Bestaande_Lening);

    expect(normalized).toHaveProperty('leningdelen');
    expect(normalized.leningdelen[0]).toHaveProperty('huidige_schuld', 50000);
  });
});
