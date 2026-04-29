import type {
  ConversationMappingNode,
  ConversationPayload,
} from '../../lib/shared/conversation-trim';

type FixtureRole = 'user' | 'assistant' | 'system' | 'tool' | null;

interface FixtureNodeOptions {
  contentType?: string;
  parts?: unknown[];
  hidden?: boolean;
  metadata?: Record<string, unknown>;
}

function createNode(
  id: string,
  role: FixtureRole,
  parent: string | null,
  text: string,
  createTime: number,
  options: FixtureNodeOptions = {},
): ConversationMappingNode {
  return {
    id,
    parent,
    children: [],
    message:
      role == null
        ? null
        : {
            id,
            author: { role, name: null, metadata: {} },
            create_time: createTime,
            update_time: null,
            content: {
              content_type: options.contentType ?? 'text',
              parts: options.parts ?? [text],
            },
            status: 'finished_successfully',
            metadata: {
              ...(options.hidden ? { is_visually_hidden_from_conversation: true } : {}),
              ...(options.metadata ?? {}),
            },
          },
  };
}

function connect(mapping: Record<string, ConversationMappingNode>, parent: string, child: string): void {
  mapping[parent]!.children = [...(mapping[parent]!.children ?? []), child];
}

export function buildBasicSlidingWindowPayload(pairCount = 4): ConversationPayload {
  const mapping: Record<string, ConversationMappingNode> = {
    root: createNode('root', null, null, '', 0),
    system: createNode('system', 'system', 'root', 'system scaffold', 1),
  };
  connect(mapping, 'root', 'system');

  let parent = 'system';
  let time = 2;
  for (let index = 1; index <= pairCount; index += 1) {
    const userId = `user${index}`;
    const assistantId = `assistant${index}`;
    mapping[userId] = createNode(userId, 'user', parent, `user-${index}`, time);
    connect(mapping, parent, userId);
    time += 1;

    mapping[assistantId] = createNode(assistantId, 'assistant', userId, `assistant-${index}`, time);
    connect(mapping, userId, assistantId);
    time += 1;
    parent = assistantId;
  }

  return {
    current_node: `assistant${pairCount}`,
    mapping,
  };
}

export function buildShortSlidingWindowPayload(): ConversationPayload {
  return buildBasicSlidingWindowPayload(1);
}

export function buildToolSlidingWindowPayload(): ConversationPayload {
  const payload = buildBasicSlidingWindowPayload(2);
  const mapping = payload.mapping!;
  mapping.tool1 = createNode('tool1', 'tool', 'assistant1', 'tool raw stdout secret-token', 4, {
    contentType: 'tool_result',
    parts: [{ type: 'tool_result', payload: { stdout: 'tool raw stdout secret-token' } }],
  });
  mapping.assistantTool = createNode('assistantTool', 'assistant', 'tool1', 'tool-visible-answer', 5);
  mapping.user2!.parent = 'assistantTool';
  mapping.assistant1!.children = ['tool1'];
  connect(mapping, 'tool1', 'assistantTool');
  connect(mapping, 'assistantTool', 'user2');

  return {
    current_node: 'assistant2',
    mapping,
  };
}

export function buildHiddenSlidingWindowPayload(): ConversationPayload {
  const mapping: Record<string, ConversationMappingNode> = {
    root: createNode('root', null, null, '', 0),
    system: createNode('system', 'system', 'root', 'hidden system scaffold', 1, { hidden: true }),
    user1: createNode('user1', 'user', 'system', 'visible user', 2),
    thinking1: createNode('thinking1', 'assistant', 'user1', 'private chain of thought', 3, {
      contentType: 'thoughts',
      hidden: true,
    }),
    assistant1: createNode('assistant1', 'assistant', 'thinking1', 'visible assistant', 4),
  };
  connect(mapping, 'root', 'system');
  connect(mapping, 'system', 'user1');
  connect(mapping, 'user1', 'thinking1');
  connect(mapping, 'thinking1', 'assistant1');

  return {
    current_node: 'assistant1',
    mapping,
  };
}

export function buildBranchSlidingWindowPayload(): ConversationPayload {
  const payload = buildBasicSlidingWindowPayload(2);
  const mapping = payload.mapping!;
  mapping.branchUser = createNode('branchUser', 'user', 'assistant1', 'branch user', 6);
  mapping.branchAssistant = createNode('branchAssistant', 'assistant', 'branchUser', 'branch assistant', 7);
  mapping.assistant1!.children = [...(mapping.assistant1!.children ?? []), 'branchUser'];
  connect(mapping, 'branchUser', 'branchAssistant');

  return {
    current_node: 'assistant2',
    mapping,
  };
}

export function buildInvalidSlidingWindowPayload(): ConversationPayload {
  const payload = buildBasicSlidingWindowPayload(1);
  payload.mapping!.assistant1!.children = ['missing-child'];
  return payload;
}
