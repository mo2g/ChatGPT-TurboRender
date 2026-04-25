export function waitForRemoteDebugEndpoint(port: number, timeoutMs?: number): Promise<void>;

export function spawnLaunchableChromium(options?: {
  repoRoot?: string;
  targetUrl?: string;
  debugPort?: number;
  userDataDir?: string;
  waitForReady?: boolean;
  browserBinary?: string;
  extensionPath?: string;
}): Promise<{
  child: {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill(signal?: NodeJS.Signals | number): boolean;
  };
  debugPort: number;
  userDataDir: string;
}>;
