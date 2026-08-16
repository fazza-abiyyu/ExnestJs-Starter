import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import {
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfEngineError } from '../types.js';

export const DEFAULT_SCALE = 1.5;

export function looksLikePdf(data: Uint8Array, maxScan = 1024): boolean {
  const window = data.slice(0, Math.min(maxScan, data.length));
  return window.includes(0x25) && new TextDecoder().decode(window).includes('%PDF-');
}

export interface PageInfo {
  page: number;
  width: number;
  height: number;
}

export interface RasterizeOptions {
  scale?: number;
  watermark?: string;
}

async function loadDocument(pdfPath: string): Promise<{
  loadingTask: PDFDocumentLoadingTask;
  pageCount: number;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
}> {
  const data = new Uint8Array(await readFile(pdfPath));
  const assetUrl = (subPath: string) => {
    const url = pathToFileURL(resolve(process.cwd(), 'node_modules/pdfjs-dist', subPath)).href;
    return url.endsWith('/') ? url : `${url}/`;
  };
  const loadingTask = getDocument({
    data,
    standardFontDataUrl: assetUrl('standard_fonts/'),
    cMapUrl: assetUrl('cmaps/'),
    cMapPacked: true,
  });
  const doc = await loadingTask.promise;
  const getPage = doc.getPage.bind(doc);
  return { loadingTask, pageCount: doc.numPages, getPage };
}

function applyWatermark(
  ctx: unknown,
  width: number,
  height: number,
  text: string | undefined,
): void {
  if (!text) return;

  const context = ctx as CanvasRenderingContext2D;
  const fontSize = Math.max(24, height * 0.045);
  context.save();
  context.globalAlpha = 0.16;
  context.font = `bold ${fontSize}px sans-serif`;
  context.fillStyle = '#000000';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.translate(width / 2, height / 2);
  context.rotate(-Math.PI / 5);

  const reach = Math.sqrt(width * width + height * height);
  const stepY = fontSize * 4.5;
  const stepX = fontSize * 16;

  for (let y = -reach; y <= reach; y += stepY) {
    for (let x = -reach; x <= reach; x += stepX) {
      context.fillText(text, x, y);
    }
  }

  context.restore();
}

async function renderIntoCanvas(
  page: PDFPageProxy,
  options: RasterizeOptions,
): Promise<{ width: number; height: number; png: Uint8Array }> {
  const scale = options.scale ?? DEFAULT_SCALE;
  const viewport = page.getViewport({ scale });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);

  const canvas = createCanvas(width, height);
  const canvasContext = canvas.getContext('2d');

  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  applyWatermark(canvasContext, width, height, options.watermark);
  const png = new Uint8Array(canvas.toBuffer('image/png'));
  return { width, height, png };
}

export async function getPageCount(pdfPath: string): Promise<number> {
  const loaded = await loadDocument(pdfPath);
  const pageCount = loaded.pageCount;
  await loaded.loadingTask.destroy();
  return pageCount;
}

export async function renderAll(
  pdfPath: string,
  outDir: string,
  options: RasterizeOptions = {},
): Promise<{ pageCount: number; pages: PageInfo[] }> {
  const loaded = await loadDocument(pdfPath);
  const pages: PageInfo[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= loaded.pageCount; pageNumber++) {
      const page = await loaded.getPage(pageNumber);
      const { width, height, png } = await renderIntoCanvas(page, options);
      await writeFile(`${outDir}/page-${pageNumber}.png`, png);
      pages.push({ page: pageNumber, width, height });
    }
  } finally {
    await loaded.loadingTask.destroy();
  }

  return { pageCount: pages.length, pages };
}

export async function renderOne(
  pdfPath: string,
  pageNumber: number,
  outPath: string,
  options: RasterizeOptions = {},
): Promise<PageInfo> {
  const loaded = await loadDocument(pdfPath);
  try {
    const page = await loaded.getPage(pageNumber);
    const { width, height, png } = await renderIntoCanvas(page, options);
    await writeFile(outPath, png);
    return { page: pageNumber, width, height };
  } finally {
    await loaded.loadingTask.destroy();
  }
}

export interface RasterJob {
  sourcePath: string;
  outDir: string;
  scale: number;
  watermark?: string | null;
  timeoutMs?: number;
}

export class Rasterizer {
  private readonly queue: {
    job: RasterJob;
    resolve: (result: { pageCount: number }) => void;
    reject: (err: Error) => void;
  }[] = [];
  private running = 0;
  private readonly maxSlots: number;
  private readonly timeoutMs: number;

  constructor(maxSlots = 1, timeoutMs = 60_000) {
    this.maxSlots = Math.max(1, Math.floor(maxSlots));
    this.timeoutMs = timeoutMs > 0 ? timeoutMs : 60_000;
  }

  get pending() {
    return this.queue.length;
  }

  enqueue(job: RasterJob): Promise<{ pageCount: number }> {
    return new Promise<{ pageCount: number }>((resolveJob, reject) => {
      this.queue.push({ job, resolve: resolveJob, reject });
      this.pump();
    });
  }

  killAll(): void {
    this.queue.length = 0;
  }

  private pump(): void {
    while (this.running < this.maxSlots && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      void this.run(next);
    }
  }

  private async run(item: {
    job: RasterJob;
    resolve: (result: { pageCount: number }) => void;
    reject: (err: Error) => void;
  }): Promise<void> {
    this.running++;
    try {
      const { job } = item;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await new Promise<{ pageCount: number }>((resolveJob, rejectJob) => {
        timer = setTimeout(
          () => rejectJob(new Error('rasterization timed out')),
          job.timeoutMs ?? this.timeoutMs,
        );
        renderAll(job.sourcePath, job.outDir, {
          scale: job.scale,
          watermark: job.watermark ?? undefined,
        })
          .then(({ pageCount }) => resolveJob({ pageCount }))
          .catch(rejectJob)
          .finally(() => clearTimeout(timer));
      });
      item.resolve(result);
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running--;
      this.pump();
    }
  }
}

export function isPdfEngineError(err: unknown): err is PdfEngineError {
  return err instanceof PdfEngineError;
}
