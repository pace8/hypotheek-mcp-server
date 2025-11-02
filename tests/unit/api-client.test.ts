import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ApiClient, resetApiClient } from '../../src/api/client.js';
import { ErrorCode } from '../../src/types/index.js';

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    resetApiClient();
    client = new ApiClient();
  });

  describe('Retry Logic', () => {
    it('should retry on 5xx errors', async () => {
      // TODO: implement mock/fetch interception to simulate 5xx responses
    });

    it('should not retry on 4xx errors', async () => {
      // TODO: implement mock/fetch interception to simulate 4xx responses
    });

    it('should respect maxRetries config', async () => {
      // TODO: implement
    });
  });

  describe('Timeout', () => {
    it('should timeout after configured duration', async () => {
      // TODO: implement using a slow response simulation
    });

    it('should throw API_TIMEOUT error', async () => {
      // TODO: assert mapping to ErrorCode.API_TIMEOUT
    });
  });

  describe('Error Mapping', () => {
    it('should map 429 to API_RATE_LIMIT', async () => {
      // TODO: simulate 429 response and assert mapped error code
    });

    it('should map timeout to API_TIMEOUT', async () => {
      // TODO: simulate timeout and assert mapped error code
    });
  });
});
