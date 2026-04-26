export type ReadAloudStreamingDebugState = '0' | '1' | 'unsupported' | 'error';

export interface TryStreamReadAloudResponseOptions {
  win: Window;
  response: Response;
  audio: HTMLAudioElement;
  entryKey: string;
  generation: number;
  isCurrent(entryKey: string, generation: number): boolean;
  onObjectUrlCreated(objectUrl: string): void;
  onObjectUrlUnused(objectUrl: string): void;
  setStreamingDebug(value: ReadAloudStreamingDebugState): void;
  clearPlayback(): void;
}

export async function tryStreamReadAloudResponse(
  options: TryStreamReadAloudResponseOptions,
): Promise<boolean> {
  const {
    win,
    response,
    audio,
    entryKey,
    generation,
    isCurrent,
    onObjectUrlCreated,
    onObjectUrlUnused,
    setStreamingDebug,
    clearPlayback,
  } = options;
  const stream = response.body;
  const mimeType = resolveReadAloudStreamMimeType(win, response);
  const MediaSourceCtor = (win as Window & { MediaSource?: typeof MediaSource }).MediaSource;
  if (stream == null || mimeType == null || MediaSourceCtor == null) {
    setStreamingDebug('unsupported');
    return false;
  }

  const mediaSource = new MediaSourceCtor();
  const objectUrl = URL.createObjectURL(mediaSource);
  onObjectUrlCreated(objectUrl);
  audio.src = objectUrl;
  audio.load();

  const cleanupObjectUrl = (): void => {
    onObjectUrlUnused(objectUrl);
    audio.removeAttribute('src');
    try {
      audio.load();
    } catch {
      // Ignore load failures in detached/test contexts.
    }
    URL.revokeObjectURL(objectUrl);
  };

  const opened = await waitForMediaSourceOpen(win, mediaSource);
  if (!opened || !isCurrent(entryKey, generation)) {
    cleanupObjectUrl();
    return false;
  }

  let sourceBuffer: SourceBuffer;
  try {
    sourceBuffer = mediaSource.addSourceBuffer(mimeType);
  } catch {
    cleanupObjectUrl();
    setStreamingDebug('unsupported');
    return false;
  }

  const reader = stream.getReader();
  let started = false;
  setStreamingDebug('1');
  audio.dataset.turboRenderReadAloudMode = 'backend-stream';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (!isCurrent(entryKey, generation)) {
        await reader.cancel().catch(() => undefined);
        return true;
      }
      if (done) {
        break;
      }
      if (value == null || value.byteLength === 0) {
        continue;
      }
      await appendReadAloudChunk(sourceBuffer, value);
      if (!started) {
        started = true;
        await audio.play();
      }
    }

    if (!started) {
      clearPlayback();
      return true;
    }
    if (mediaSource.readyState === 'open') {
      mediaSource.endOfStream();
    }
    return true;
  } catch {
    if (!isCurrent(entryKey, generation)) {
      return true;
    }
    setStreamingDebug('error');
    clearPlayback();
    return true;
  } finally {
    reader.releaseLock();
  }
}

export function resolveReadAloudStreamMimeType(win: Window, response: Response): string | null {
  const MediaSourceCtor = (win as Window & { MediaSource?: typeof MediaSource }).MediaSource;
  if (MediaSourceCtor == null || typeof MediaSourceCtor.isTypeSupported !== 'function') {
    return null;
  }

  const responseType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const candidates = [
    responseType,
    responseType === 'audio/aac' ? 'audio/aac' : '',
    responseType.includes('aac') ? 'audio/mp4; codecs="mp4a.40.2"' : '',
    responseType === 'audio/mpeg' ? 'audio/mpeg' : '',
  ].filter((candidate): candidate is string => candidate.length > 0);

  for (const candidate of [...new Set(candidates)]) {
    if (MediaSourceCtor.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return null;
}

function waitForMediaSourceOpen(win: Window, mediaSource: MediaSource): Promise<boolean> {
  if (mediaSource.readyState === 'open') {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout = win.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      mediaSource.removeEventListener('sourceopen', onOpen);
      resolve(false);
    }, 3000);
    const onOpen = () => {
      if (settled) {
        return;
      }
      settled = true;
      win.clearTimeout(timeout);
      resolve(true);
    };
    mediaSource.addEventListener('sourceopen', onOpen);
  });
}

function appendReadAloudChunk(sourceBuffer: SourceBuffer, chunk: Uint8Array): Promise<void> {
  if (chunk.byteLength === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener('updateend', onUpdateEnd);
      sourceBuffer.removeEventListener('error', onError);
    };
    const onUpdateEnd = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('read aloud source buffer append failed'));
    };
    sourceBuffer.addEventListener('updateend', onUpdateEnd);
    sourceBuffer.addEventListener('error', onError);
    try {
      const buffer = new Uint8Array(chunk.byteLength);
      buffer.set(chunk);
      sourceBuffer.appendBuffer(buffer.buffer);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
