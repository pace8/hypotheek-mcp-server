/**
 * Validation Tests - Happy Paths (Fase 1)
 * 
 * Test de belangrijkste validatie scenarios
 */

import { describe, it, expect } from '@jest/globals';
import { 
  validateBaseArguments,
  validateDoorstromerArguments,
  validateLeningdeel
} from '../../src/validation/schemas';
import { ValidationError, ErrorCode } from '../../src/types/index';

describe('BaseArguments Validation', () => {
  describe('Happy Path', () => {
    it('should accept valid starter input (alleenstaand)', () => {
      const validInput = {
        inkomen_aanvrager: 50000,
        geboortedatum_aanvrager: '1990-05-15',
        heeft_partner: false,
        verplichtingen_pm: 0
      };
      
      expect(() => validateBaseArguments(validInput)).not.toThrow();
    });
    
    it('should accept valid starter input with partner', () => {
      const validInput = {
        inkomen_aanvrager: 50000,
        geboortedatum_aanvrager: '1990-05-15',
        heeft_partner: true,
        inkomen_partner: 40000,
        geboortedatum_partner: '1992-08-20',
        verplichtingen_pm: 250
      };
      
      expect(() => validateBaseArguments(validInput)).not.toThrow();
    });
    
    it('should accept partner without income', () => {
      const validInput = {
        inkomen_aanvrager: 50000,
        geboortedatum_aanvrager: '1990-05-15',
        heeft_partner: true,
        inkomen_partner: 0,
        geboortedatum_partner: '1992-08-20',
        verplichtingen_pm: 0
      };
      
      expect(() => validateBaseArguments(validInput)).not.toThrow();
    });
  });
  
  describe('Edge Cases - Age', () => {
    it('should accept young applicants (age checks delegated to API)', () => {
      const input = {
        inkomen_aanvrager: 30000,
        geboortedatum_aanvrager: '2010-01-01',
        heeft_partner: false,
        verplichtingen_pm: 0,
      };

      expect(() => validateBaseArguments(input)).not.toThrow();
    });

    it('should accept senior applicants (age checks delegated to API)', () => {
      const input = {
        inkomen_aanvrager: 50000,
        geboortedatum_aanvrager: '1940-01-01',
        heeft_partner: false,
        verplichtingen_pm: 0,
      };

      expect(() => validateBaseArguments(input)).not.toThrow();
    });
  });
  
  describe('Edge Cases - Income', () => {
    it('should reject negative income', () => {
      const input = {
        inkomen_aanvrager: -1000,
        geboortedatum_aanvrager: '1990-05-15',
        heeft_partner: false
      };
      
      expect(() => validateBaseArguments(input)).toThrow(ValidationError);
    });
    
    it('should accept income at minimum (€0)', () => {
      const input = {
        inkomen_aanvrager: 0,
        geboortedatum_aanvrager: '1990-05-15',
        heeft_partner: false,
        verplichtingen_pm: 0
      };
      
      expect(() => validateBaseArguments(input)).not.toThrow();
    });
    
    it('should accept income at maximum (€1M)', () => {
      const input = {
        inkomen_aanvrager: 1_000_000,
        geboortedatum_aanvrager: '1990-05-15',
        heeft_partner: false,
        verplichtingen_pm: 0
      };
      
      expect(() => validateBaseArguments(input)).not.toThrow();
    });
    
    it('should reject income over maximum', () => {
      const input = {
        inkomen_aanvrager: 1_000_001,
        geboortedatum_aanvrager: '1990-05-15',
        heeft_partner: false
      };
      
      expect(() => validateBaseArguments(input)).toThrow(ValidationError);
    });
  });
  
  describe('Date Format Validation', () => {
    it('should reject invalid date format (DD-MM-YYYY)', () => {
      const input = {
        inkomen_aanvrager: 50000,
        geboortedatum_aanvrager: '15-05-1990', // Wrong format
        heeft_partner: false
      };
      
      expect(() => validateBaseArguments(input)).toThrow(ValidationError);
      
      try {
        validateBaseArguments(input);
      } catch (error) {
        expect((error as ValidationError).code).toBe(ErrorCode.INVALID_DATE_FORMAT);
      }
    });
    
    it('should reject future date', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];
      
      const input = {
        inkomen_aanvrager: 50000,
        geboortedatum_aanvrager: futureDateStr,
        heeft_partner: false
      };
      
      expect(() => validateBaseArguments(input)).toThrow(ValidationError);
    });
    
    it('should reject invalid date (2024-02-30)', () => {
      const input = {
        inkomen_aanvrager: 50000,
        geboortedatum_aanvrager: '2024-02-30', // February doesn't have 30 days
        heeft_partner: false
      };
      
      expect(() => validateBaseArguments(input)).toThrow(ValidationError);
    });
  });
});

describe('Leningdeel Validation', () => {
  describe('Happy Path', () => {
    it('should accept valid leningdeel', () => {
      const validLeningdeel = {
        huidige_schuld: 200000,
        huidige_rente: 0.035, // 3.5%
        resterende_looptijd_in_maanden: 240, // 20 jaar
        rentevasteperiode_maanden: 60, // 5 jaar
        hypotheekvorm: 'annuiteit'
      };
      
      expect(() => validateLeningdeel(validLeningdeel, 0)).not.toThrow();
    });
    
    it('should accept variable rate (0 months fixed)', () => {
      const variableLeningdeel = {
        huidige_schuld: 150000,
        huidige_rente: 0.045, // 4.5%
        resterende_looptijd_in_maanden: 180,
        rentevasteperiode_maanden: 0, // Variable
        hypotheekvorm: 'annuiteit'
      };
      
      expect(() => validateLeningdeel(variableLeningdeel, 0)).not.toThrow();
    });
  });
  
  describe('Edge Cases', () => {
    it('should reject rentevast exceeding looptijd', () => {
      const invalidLeningdeel = {
        huidige_schuld: 200000,
        huidige_rente: 0.035,
        resterende_looptijd_in_maanden: 120,
        rentevasteperiode_maanden: 180, // More than looptijd!
        hypotheekvorm: 'annuiteit'
      };
      
      expect(() => validateLeningdeel(invalidLeningdeel, 0)).toThrow(ValidationError);
      
      try {
        validateLeningdeel(invalidLeningdeel, 0);
      } catch (error) {
        expect((error as ValidationError).code).toBe(ErrorCode.RENTEVAST_EXCEEDS_LOOPTIJD);
      }
    });
    
    it('should reject interest rate > 20%', () => {
      const invalidLeningdeel = {
        huidige_schuld: 200000,
        huidige_rente: 0.25, // 25% - too high
        resterende_looptijd_in_maanden: 240,
        rentevasteperiode_maanden: 60,
        hypotheekvorm: 'annuiteit'
      };
      
      expect(() => validateLeningdeel(invalidLeningdeel, 0)).toThrow(ValidationError);
    });
  });
});

describe('DoorstromerArguments Validation', () => {
  describe('Happy Path', () => {
    it('should accept valid doorstromer input', () => {
      const validInput = {
        // Base
        inkomen_aanvrager: 65000,
        geboortedatum_aanvrager: '1985-03-15',
        heeft_partner: true,
        inkomen_partner: 45000,
        geboortedatum_partner: '1987-07-20',
        verplichtingen_pm: 0,
        // Doorstromer specific
        waarde_huidige_woning: 350000,
        bestaande_hypotheek: {
          leningdelen: [{
            huidige_schuld: 180000,
            huidige_rente: 0.032,
            resterende_looptijd_in_maanden: 240,
            rentevasteperiode_maanden: 120,
            hypotheekvorm: 'annuiteit'
          }]
        }
      };
      
      expect(() => validateDoorstromerArguments(validInput)).not.toThrow();
    });
    
    it('should accept multiple leningdelen', () => {
      const validInput = {
        inkomen_aanvrager: 70000,
        geboortedatum_aanvrager: '1980-01-01',
        heeft_partner: false,
        verplichtingen_pm: 0,
        waarde_huidige_woning: 400000,
        bestaande_hypotheek: {
          leningdelen: [
            {
              huidige_schuld: 150000,
              huidige_rente: 0.025,
              resterende_looptijd_in_maanden: 180,
              rentevasteperiode_maanden: 60,
              hypotheekvorm: 'annuiteit'
            },
            {
              huidige_schuld: 50000,
              huidige_rente: 0.04,
              resterende_looptijd_in_maanden: 120,
              rentevasteperiode_maanden: 0,
              hypotheekvorm: 'aflossingsvrij'
            }
          ]
        }
      };
      
      expect(() => validateDoorstromerArguments(validInput)).not.toThrow();
    });
  });
  
  describe('Edge Cases', () => {
    it('should reject missing bestaande_hypotheek', () => {
      const invalidInput = {
        inkomen_aanvrager: 65000,
        geboortedatum_aanvrager: '1985-03-15',
        heeft_partner: false,
        verplichtingen_pm: 0,
        waarde_huidige_woning: 350000
        // Missing: bestaande_hypotheek
      };
      
      expect(() => validateDoorstromerArguments(invalidInput)).toThrow(ValidationError);
    });
    
    it('should reject too many leningdelen (>10)', () => {
      const leningdelen = Array(11).fill({
        huidige_schuld: 10000,
        huidige_rente: 0.03,
        resterende_looptijd_in_maanden: 120,
        rentevasteperiode_maanden: 60,
        hypotheekvorm: 'annuiteit'
      });
      
      const invalidInput = {
        inkomen_aanvrager: 65000,
        geboortedatum_aanvrager: '1985-03-15',
        heeft_partner: false,
        verplichtingen_pm: 0,
        waarde_huidige_woning: 350000,
        bestaande_hypotheek: {
          leningdelen
        }
      };
      
      expect(() => validateDoorstromerArguments(invalidInput)).toThrow(ValidationError);
      
      try {
        validateDoorstromerArguments(invalidInput);
      } catch (error) {
        expect((error as ValidationError).code).toBe(ErrorCode.TOO_MANY_LENINGDELEN);
      }
    });
  });
});

// -----------------------------------------------------------------------------
// Extra tests for STAP 3 (strictere enum normalisatie) and blocking behaviour
// -----------------------------------------------------------------------------
import { normalizeHypotheekvorm, normalizeEnergielabel } from '../../src/types/index';

describe('Enum normalization (stricter) and blocking behaviour', () => {
  describe('normalizeHypotheekvorm', () => {
    it("should accept exact spelling 'annuiteit' (case-insensitive via lowercasing)", () => {
      expect(normalizeHypotheekvorm('annuiteit')).toBeDefined();
      expect(normalizeHypotheekvorm('Annuiteit')).toBeDefined();
    });

    it("should reject alternative spelling 'annuïteit' (accent not allowed)", () => {
      expect(() => normalizeHypotheekvorm('annuïteit')).toThrow();
    });
  });

  describe('normalizeEnergielabel', () => {
    it("should accept exact 'A++++' but reject lowercase 'a++++'", () => {
      expect(normalizeEnergielabel('A++++')).toBeDefined();
      expect(() => normalizeEnergielabel('a++++')).toThrow();
    });
  });

  describe('Validation blocking', () => {
    it('validateBaseArguments should throw ValidationError (blocking) on invalid input', () => {
      const bad = {
        inkomen_aanvrager: 'not-a-number',
        geboortedatum_aanvrager: '1990-05-15',
        heeft_partner: false
      } as any;

      expect(() => {
        // @ts-ignore - intentional wrong type
        validateBaseArguments(bad);
      }).toThrow();
    });
  });
});
