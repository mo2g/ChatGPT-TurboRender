import type { Server } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChatgptFixtureDefinition } from '../legacy/fixtures/chatgpt-fixtures';
import { resolveChatgptFixturePaths, resolveChatgptFixtureRoot } from '../legacy/fixtures/chatgpt-fixtures';

interface MockServerOptions {
  fixture: ChatgptFixtureDefinition;
  port?: number;
}

interface MockServer {
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Creates a mock server that proxies most requests to the real ChatGPT
 * but intercepts key APIs to return fixture data.
 */
export async function createChatgptMockServer(options: MockServerOptions): Promise<MockServer> {
  const { fixture, port = 0 } = options;
  const filePaths = resolveChatgptFixturePaths(fixture, resolveChatgptFixtureRoot());

  // Load fixture data
  const conversationJson = await readFile(filePaths.conversationJson, 'utf-8').then(
    (data) => JSON.parse(data),
    () => null,
  );

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Mock conversation API
    if (url.pathname.includes('/backend-api/conversation/') && !url.pathname.includes('/stream')) {
      handleConversationRequest(res, conversationJson, fixture.conversationId);
      return;
    }

    // Mock synthesize API
    if (url.pathname.includes('/backend-api/synthesize')) {
      handleSynthesizeRequest(req, res, url, fixture.conversationId);
      return;
    }

    // Proxy all other requests to real ChatGPT
    proxyToChatGPT(req, res, url);
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const actualPort = (server.address() as { port: number }).port;
      resolve({
        baseUrl: `http://localhost:${actualPort}`,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
    server.on('error', reject);
  });
}

function handleConversationRequest(
  res: import('node:http').ServerResponse,
  conversationJson: unknown,
  conversationId: string,
): void {
  if (!conversationJson) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Conversation not found' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(conversationJson));
  console.log(`[MockServer] Served conversation ${conversationId}`);
}

function handleSynthesizeRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  url: URL,
  conversationId: string,
): void {
  const messageId = url.searchParams.get('message_id');

  // Return a mock synthesize response with a placeholder audio URL
  // Using a short silent MP3 or beep sound
  const mockResponse = {
    url: 'https://www.soundjay.com/misc/sounds/beep-01a.mp3',
    duration_ms: 1000,
    voice: 'cove',
    conversation_id: conversationId,
    message_id: messageId,
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(mockResponse));
  console.log(`[MockServer] Served synthesize for message ${messageId}`);
}

function proxyToChatGPT(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  url: URL,
): void {
  const options = {
    hostname: 'chatgpt.com',
    port: 443,
    path: url.pathname + url.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: 'chatgpt.com',
    },
  };

  const proxyReq = httpRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}
