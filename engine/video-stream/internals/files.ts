import { existsSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';
import { VideoEngineError } from '../types.js';

export function resolveInside(root: string, ...parts: string[]): string {
  const base = resolve(root);
  if (parts.some((p) => p === '..' || p.split(sep).includes('..'))) {
    throw new VideoEngineError('PATH_TRAVERSAL', 'Forbidden path', 403);
  }
  const joined = resolve(base, ...parts);
  if (joined !== base && !joined.startsWith(base + sep)) {
    throw new VideoEngineError('PATH_TRAVERSAL', 'Forbidden path', 403);
  }
  return joined;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function isFileAt(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

export function baseDir(storageDir: string): string {
  return resolve(storageDir, 'videos');
}

export function videoDir(storageDir: string, id: string): string {
  return resolveInside(baseDir(storageDir), normalize(id));
}

export function videoSourceDir(videoRoot: string): string {
  return resolve(videoRoot, 'source');
}

export function videoHlsDir(videoRoot: string): string {
  return resolve(videoRoot, 'hls');
}

export function sourceFilePath(videoRoot: string, fileName: string): string {
  return resolveInside(videoSourceDir(videoRoot), normalize(fileName));
}
