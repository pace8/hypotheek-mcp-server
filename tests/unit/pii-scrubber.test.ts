import { describe, it, expect } from '@jest/globals';
import {
  scrubPII,
  applyRedaction,
  RedactionLevel,
  containsPII,
  assertNoPII
} from '../../src/utils/pii-scrubber';

describe('PII Scrubber', () => {
  it('should redact emails inside strings', () => {
    const result = scrubPII('alice@example.com');
    expect(typeof result).toBe('string');
    expect((result as string).toLowerCase()).toContain('[redacted]');
  });

  it('should redact known object fields', () => {
    const input = { email: 'bob@domain.com', name: 'Bob', telefoonnummer: '0612345678' };
    const out = scrubPII(input) as Record<string, unknown>;
    expect(out.email).toBe('[REDACTED]');
    expect(out.name).toBe('[REDACTED]');
    expect(out.telefoonnummer).toBe('[REDACTED]');
  });

  it('applyRedaction FULL should redact sensitive values', () => {
    const input = { email: 'x@y.com', inkomen_aanvrager: 55000 };
    const out = applyRedaction(input, RedactionLevel.FULL) as Record<string, unknown>;
    expect(out.email).toBe('[REDACTED]');
    // Under FULL redaction numeric PII fields are also redacted
    expect(out.inkomen_aanvrager).toBe('[REDACTED]');
  });

  it('containsPII should detect email-like strings', () => {
    expect(containsPII('contact: user@test.nl')).toBe(true);
    expect(containsPII('no pii here')).toBe(false);
  });

  it('assertNoPII should throw when message contains PII', () => {
    expect(() => assertNoPII('this is bad: alice@example.com')).toThrow();
  });
});
