import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { looksLikePdf, getPageCount, renderAll } from './raster.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

let dir: string;
let pdfPath: string;

async function makePdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage();
    page.drawText(`Page ${i}`, { x: 100, y: 700, font, size: 24 });
  }
  const bytes = await doc.save();
  const path = join(dir, 'sample.pdf');
  await Bun.write(path, bytes);
  return path;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdf-raster-'));
  pdfPath = await makePdf();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('raster', () => {
  test('looksLikePdf detects PDF magic bytes', async () => {
    const data = new Uint8Array(await readFile(pdfPath));
    expect(looksLikePdf(data)).toBe(true);
    expect(looksLikePdf(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });

  test('getPageCount reads the page count', async () => {
    expect(await getPageCount(pdfPath)).toBe(3);
  });

  test('renderAll outputs one PNG per page', async () => {
    const outDir = join(dir, 'pages');
    await Bun.$`mkdir -p ${outDir}`.quiet();
    const result = await renderAll(pdfPath, outDir, { watermark: 'TEST' });
    expect(result.pageCount).toBe(3);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0].width).toBeGreaterThan(0);

    const png = new Uint8Array(await readFile(join(outDir, 'page-3.png')));
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      expect(png[i]).toBe(PNG_SIGNATURE[i]);
    }
  });
});
