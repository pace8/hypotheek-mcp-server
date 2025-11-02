import { describe, it, expect, beforeEach } from '@jest/globals';
import { RateLimiter } from '../../src/middleware/rate-limiter.js';
import { ErrorCode } from '../../src/types/index.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  describe('Rate Limiting', () => {
    it('should allow requests within limit', () => {
      for (let i = 0; i < 100; i++) {
        const info = limiter.checkLimit('test-session');
        expect(info.allowed).toBe(true);
      }
    });

    it('should block after limit exceeded', () => {
      // Hit limit
      for (let i = 0; i < 100; i++) {
        limiter.checkLimit('test-session');
      }

      // Should block
      const info = limiter.checkLimit('test-session');
      expect(info.allowed).toBe(false);
      expect(info.retryAfter).toBeGreaterThan(0);
    });

    it('should track per session separately', () => {
      // Session 1
      for (let i = 0; i < 100; i++) {
        limiter.checkLimit('session-1');
      }

      // Session 2 should still work
      const info = limiter.checkLimit('session-2');
      expect(info.allowed).toBe(true);
    });
  });

  describe('Sliding Window', () => {
    it('should reset after window expires', async () => {
      // TODO: implement with mocked timers or by exposing internals
    });
  });
});
