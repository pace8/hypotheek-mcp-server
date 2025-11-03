import { McpError, ErrorCode as McpErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getPrompt, listPrompts } from '../../src/prompts/index.js';
import { ErrorCode } from '../../src/types/index.js';

describe('MCP prompts', () => {
  it('lists all prompt metadata including arguments', () => {
    const prompts = listPrompts();
    const names = prompts.map((prompt) => prompt.name);

    expect(names).toEqual(['intake-kickoff', 'offer-review', 'output-formatting', 'recovery-plan']);
    const intake = prompts.find((prompt) => prompt.name === 'intake-kickoff');
    expect(intake?.arguments).toBeDefined();
    expect(intake?.arguments?.length).toBeGreaterThanOrEqual(2);

    const outputFormatting = prompts.find((prompt) => prompt.name === 'output-formatting');
    expect(outputFormatting?.arguments?.[0].required).toBe(true);
  });

  it('builds intake prompt with defaults and resource links', () => {
    const result = getPrompt('intake-kickoff', { klantnaam: 'Piet' });
    expect(result.description).toContain('intake');
    expect(result.messages[0].content).toMatchObject({
      type: 'text',
    });
    const resourceUris = result.messages
      .filter((message) => message.content.type === 'resource_link')
      .map((message) => message.content.uri);
    expect(resourceUris).toContain('hypotheek://v4/guide/quick-ref');
  });

  it('coerces numeric arguments and embeds recovery resource', () => {
    const result = getPrompt('recovery-plan', {
      error_code: ErrorCode.API_TIMEOUT,
      poging_nummer: '3',
      laatste_actie: 'Retry berekening',
    });

    expect(result.messages[0].content).toMatchObject({ type: 'text' });
    expect(result.messages[0].content.text).toContain('poging 3');
    const linkMessage = result.messages.find((message) => message.content.type === 'resource_link');
    expect(linkMessage?.content.uri).toBe('hypotheek://v4/ops/error-recovery');
  });

  it('throws MCP InvalidParams for unknown prompt', () => {
    expect(() => getPrompt('unknown', {})).toThrow(McpError);
    try {
      getPrompt('unknown', {});
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(McpErrorCode.InvalidParams);
    }
  });
});
