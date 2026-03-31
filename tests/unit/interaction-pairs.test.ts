import { describe, expect, it } from 'vitest';

import { buildInteractionPairs, stripLeadingRolePrefix } from '../../lib/shared/interaction-pairs';

describe('interaction pairs', () => {
  it('strips repeated leading role prefixes in mixed language text', () => {
    expect(stripLeadingRolePrefix('You: 你说：how to build a chatbot for pdf')).toBe(
      'how to build a chatbot for pdf',
    );
    expect(stripLeadingRolePrefix('Assistant: ChatGPT 说：Building a chatbot')).toBe(
      'Building a chatbot',
    );
  });

  it('does not modify normal content without role prefixes', () => {
    expect(stripLeadingRolePrefix('How to build a chatbot for PDF')).toBe('How to build a chatbot for PDF');
  });

  it('uses cleaned preview text when building interaction pairs', () => {
    const pairs = buildInteractionPairs([
      {
        id: 'u-1',
        role: 'user' as const,
        turnIndex: 0,
        text: 'You: 你说：how to build a chatbot for pdf',
      },
      {
        id: 'a-1',
        role: 'assistant' as const,
        turnIndex: 1,
        text: 'Assistant: ChatGPT 说：Building a chatbot for PDF can be a useful tool',
      },
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.userPreview).toBe('how to build a chatbot for pdf');
    expect(pairs[0]?.assistantPreview).toBe('Building a chatbot for PDF can be a useful tool');
  });
});
