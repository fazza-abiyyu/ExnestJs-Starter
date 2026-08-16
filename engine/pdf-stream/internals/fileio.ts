import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { PdfEngineError } from '../types.js';

export interface LocalFile {
  readonly size: number;
  stream(range?: { start: number; end: number }): ReadableStream<Uint8Array>;
}

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function openLocal(path: string): LocalFile {
  const size = statSync(path).size;
  return {
    size,
    stream(range) {
      const source = createReadStream(
        path,
        range ? { start: range.start, end: range.end } : undefined,
      );
      return Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>;
    },
  };
}

export async function writeStreamToFile(
  filePath: string,
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const sink = createWriteStream(filePath);
  const reader = stream.getReader();
  let total = 0;
  let failure: unknown = null;

  const closed = new Promise<void>((resolve) => {
    if (sink.closed) return resolve();
    sink.once('close', () => resolve());
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (maxBytes > 0 && total > maxBytes) {
        const err = new PdfEngineError(
          'PAYLOAD_TOO_LARGE',
          `Payload exceeds maximum size of ${maxBytes} bytes`,
          413,
        );
        sink.destroy(err);
        throw err;
      }
      const chunk = Buffer.from(value);
      if (!sink.write(chunk)) await once(sink, 'drain');
    }
    sink.end();
  } catch (err) {
    failure = err;
    if (!sink.destroyed) sink.destroy(err instanceof Error ? err : new Error(String(err)));
  } finally {
    try {
      if (typeof reader.releaseLock === 'function') reader.releaseLock();
    } catch {
      // reader may not expose releaseLock on some runtimes
    }
    await closed;
  }

  if (failure) {
    const message =
      typeof failure === 'string' || typeof failure === 'number'
        ? String(failure)
        : 'stream write failed';
    throw failure instanceof Error ? failure : new PdfEngineError('STREAM_WRITE', message, 500);
  }
  return total;
}
