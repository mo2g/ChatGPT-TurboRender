declare module '*/scripts/publish-stores.mjs' {
  export function publishToChromeWebStore(config: {
    zipPath: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    extensionId: string;
  }): Promise<{ success: boolean; message?: string }>;

  export function publishToFirefoxAddons(config: {
    zipPath: string;
    apiKey: string;
    apiSecret: string;
    extensionId: string;
  }): Promise<{ success: boolean; message?: string }>;

  export function extractOperationId(url: string): string | null;
  export function isBenignEdgePublishFailure(statusCode: number, responseBody: string): boolean;
  export function resolveChromeResourceIds(target: string): string[];
  export function isFirefoxVersionAlreadyExistsError(error: unknown): boolean;
  export function preflightChrome(config: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    fetchImpl?: typeof fetch;
  }): Promise<{ accessToken: string }>;
  export function normalizeTarget(target: string): string;
  export function parseArgs(args: string[]): { targets: string[]; dryRun: boolean };
}

declare module '*/scripts/reload-mcp-chrome-lib.mjs' {
  export function reloadMcpChromeLib(): Promise<void>;
}

declare module '*/scripts/package-browser-release.mjs' {
  export function downloadExistingFirefoxSignedArtifact(config: {
    sourceDir: string;
    version: string;
    artifactsDir: string;
    apiKey: string;
    apiSecret: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<string | null>;
}
