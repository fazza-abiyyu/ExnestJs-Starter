import { existsSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';
import { PdfEngineError } from '../types.js';

export function resolveInside(root: string, ...parts: string[]): string {
  const base = resolve(root);
  if (parts.some((p) => p === '..' || p.split(sep).includes('..'))) {
    throw new PdfEngineError('PATH_TRAVERSAL', 'Forbidden path', 403);
  }
  const joined = resolve(base, ...parts);
  if (joined !== base && !joined.startsWith(base + sep)) {
    throw new PdfEngineError('PATH_TRAVERSAL', 'Forbidden path', 403);
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
  return resolve(storageDir, 'docs');
}

export function docDir(storageDir: string, id: string): string {
  return resolveInside(baseDir(storageDir), normalize(id));
}

export function docSourceDir(docRoot: string): string {
  return resolve(docRoot, 'source');
}

export function docPagesDir(docRoot: string): string {
  return resolve(docRoot, 'pages');
}

export function sourceFilePath(docRoot: string, fileName: string): string {
  return resolveInside(docSourceDir(docRoot), normalize(fileName));
}

export function pageFilePath(docRoot: string, page: number): string {
  return resolveInside(docPagesDir(docRoot), `page-${page}.png`);
}

export function pageFileExists(docRoot: string, page: number): boolean {
  return isFileAt(pageFilePath(docRoot, page));
}
