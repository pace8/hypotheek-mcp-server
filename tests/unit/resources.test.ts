import { McpError, ErrorCode as McpErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { listResources, readResource, ERROR_GUIDE } from '../../src/resources/index.js';
import { ErrorCode } from '../../src/types/index.js';

describe('MCP resources', () => {
  it('returns all known resources sorted by URI', () => {
    const resources = listResources();
    const names = resources.map((item) => item.name);

    expect(names).toEqual([
      'examples-doorstromer',
      'examples-starter',
      'guide-playbook',
      'guide-quick-ref',
      'ops-error-recovery',
      'rules-format',
    ]);

    for (const resource of resources) {
      expect(resource.mimeType).toBe('text/markdown; charset=utf-8; lang=nl-NL');
    }
  });

  it('reads a text resource with metadata and etag', () => {
    const contents = readResource('hypotheek://v4/rules/format');

    expect(contents.mimeType).toBe('text/markdown; charset=utf-8; lang=nl-NL');
    expect(contents.text).toContain('Formele Formatregels');
    expect(contents.version).toBe('1.0.0');
    expect(contents.etag).toHaveLength(64);
  });

  it('throws MCP InvalidParams for unknown URIs', () => {
    expect(() => readResource('hypotheek://v4/unknown')).toThrow(McpError);
    try {
      readResource('hypotheek://v4/unknown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(McpErrorCode.InvalidParams);
    }
  });

  it('exposes structured remediation guidance for top error codes', () => {
    const entry = ERROR_GUIDE[ErrorCode.INVALID_DATE_FORMAT];
    expect(entry).toBeDefined();
    expect(entry.title).toContain('datum');
    expect(entry.resolutionSteps).toHaveLength(3);

    const timeoutEntry = ERROR_GUIDE[ErrorCode.API_TIMEOUT];
    expect(timeoutEntry.typicalCause).toMatch(/timeout/i);
    expect(timeoutEntry.goodExample).toMatch(/retry/i);
  });
});
