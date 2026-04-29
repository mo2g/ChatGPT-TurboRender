import type { ConversationPayload } from '../../shared/conversation-trim';

function stringifyPayload(payload: ConversationPayload): string | null {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

function createJsonHeaders(source?: Headers): Headers {
  const headers = new Headers(source);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return headers;
}

export function createSyntheticConversationResponse(
  payload: ConversationPayload,
  source?: Response,
): Response | null {
  const bodyText = stringifyPayload(payload);
  if (bodyText == null) {
    return null;
  }

  return new Response(bodyText, {
    status: source?.status ?? 200,
    statusText: source?.statusText ?? 'OK',
    headers: createJsonHeaders(source?.headers),
  });
}
