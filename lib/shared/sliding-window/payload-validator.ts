import type {
  ConversationMappingNode,
  ConversationPayload,
} from './types';

export type PayloadValidationIssueCode =
  | 'payload-not-object'
  | 'mapping-missing'
  | 'mapping-empty'
  | 'node-invalid'
  | 'node-id-mismatch'
  | 'children-invalid'
  | 'child-missing'
  | 'child-parent-mismatch'
  | 'parent-invalid'
  | 'parent-missing'
  | 'current-node-missing'
  | 'current-node-not-found'
  | 'ancestor-cycle';

export interface PayloadValidationIssue {
  code: PayloadValidationIssueCode;
  message: string;
  nodeId?: string;
}

export interface PayloadValidationResult {
  ok: boolean;
  issues: PayloadValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getMapping(payload: ConversationPayload): Record<string, ConversationMappingNode> | null {
  return isRecord(payload.mapping) ? payload.mapping : null;
}

function pushIssue(
  issues: PayloadValidationIssue[],
  code: PayloadValidationIssueCode,
  message: string,
  nodeId?: string,
): void {
  if (nodeId == null) {
    issues.push({ code, message });
    return;
  }

  issues.push({ code, message, nodeId });
}

function validateNodeReferences(
  mapping: Record<string, ConversationMappingNode>,
  issues: PayloadValidationIssue[],
): void {
  for (const [nodeKey, node] of Object.entries(mapping)) {
    if (!isRecord(node)) {
      pushIssue(issues, 'node-invalid', 'Mapping node must be an object.', nodeKey);
      continue;
    }

    if (typeof node.id !== 'string' || node.id.length === 0) {
      pushIssue(issues, 'node-invalid', 'Mapping node must have a string id.', nodeKey);
    } else if (node.id !== nodeKey) {
      pushIssue(issues, 'node-id-mismatch', 'Mapping key and node id must match.', nodeKey);
    }

    if (node.parent != null) {
      if (typeof node.parent !== 'string' || node.parent.length === 0) {
        pushIssue(issues, 'parent-invalid', 'Node parent must be a string or null.', nodeKey);
      } else if (mapping[node.parent] == null) {
        pushIssue(issues, 'parent-missing', 'Node parent must exist in mapping.', nodeKey);
      }
    }

    if (node.children == null) {
      continue;
    }

    if (!Array.isArray(node.children)) {
      pushIssue(issues, 'children-invalid', 'Node children must be an array.', nodeKey);
      continue;
    }

    for (const childId of node.children) {
      if (typeof childId !== 'string' || childId.length === 0) {
        pushIssue(issues, 'children-invalid', 'Child id must be a non-empty string.', nodeKey);
        continue;
      }

      const child = mapping[childId];
      if (child == null) {
        pushIssue(issues, 'child-missing', 'Child reference must exist in mapping.', nodeKey);
        continue;
      }

      if (child.parent !== nodeKey) {
        pushIssue(issues, 'child-parent-mismatch', 'Child parent must reference the containing node.', nodeKey);
      }
    }
  }
}

function validateCurrentNodeSpine(
  payload: ConversationPayload,
  mapping: Record<string, ConversationMappingNode>,
  issues: PayloadValidationIssue[],
): void {
  const currentNodeId = payload.current_node;
  if (typeof currentNodeId !== 'string' || currentNodeId.length === 0) {
    pushIssue(issues, 'current-node-missing', 'Payload current_node must be a non-empty string.');
    return;
  }

  if (mapping[currentNodeId] == null) {
    pushIssue(issues, 'current-node-not-found', 'Payload current_node must exist in mapping.', currentNodeId);
    return;
  }

  const seen = new Set<string>();
  let nodeId: string | null | undefined = currentNodeId;
  while (nodeId != null) {
    if (seen.has(nodeId)) {
      pushIssue(issues, 'ancestor-cycle', 'Current node ancestor spine must not contain a cycle.', nodeId);
      return;
    }

    seen.add(nodeId);
    const node: ConversationMappingNode | undefined = mapping[nodeId];
    if (node == null) {
      pushIssue(issues, 'parent-missing', 'Current node ancestor must exist in mapping.', nodeId);
      return;
    }

    nodeId = node.parent ?? null;
  }
}

export function validateConversationPayload(payload: unknown): PayloadValidationResult {
  const issues: PayloadValidationIssue[] = [];

  if (!isRecord(payload)) {
    return {
      ok: false,
      issues: [
        {
          code: 'payload-not-object',
          message: 'Conversation payload must be an object.',
        },
      ],
    };
  }

  const conversationPayload = payload as ConversationPayload;
  const mapping = getMapping(conversationPayload);
  if (mapping == null) {
    pushIssue(issues, 'mapping-missing', 'Conversation payload mapping must be an object.');
    return { ok: false, issues };
  }

  if (Object.keys(mapping).length === 0) {
    pushIssue(issues, 'mapping-empty', 'Conversation payload mapping must not be empty.');
    return { ok: false, issues };
  }

  validateNodeReferences(mapping, issues);
  validateCurrentNodeSpine(conversationPayload, mapping, issues);

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateSyntheticPayload(payload: unknown): PayloadValidationResult {
  return validateConversationPayload(payload);
}
