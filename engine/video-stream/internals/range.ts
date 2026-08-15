export type RangeStatus = 'no-range' | 'ok' | 'unsatisfiable';

export interface ByteRange {
  start: number;
  end: number;
}

export interface RangeResult {
  status: RangeStatus;
  range?: ByteRange;
}

export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header || header.trim().length === 0) return { status: 'no-range' };

  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return { status: 'unsatisfiable' };

  const startStr = match[1];
  const endStr = match[2];

  if (startStr === '' && endStr === '') return { status: 'unsatisfiable' };

  if (startStr === '') {
    const n = Number(endStr);
    if (!Number.isSafeInteger(n) || n <= 0 || size === 0) return { status: 'unsatisfiable' };
    const len = Math.min(n, size);
    return { status: 'ok', range: { start: size - len, end: size - 1 } };
  }

  const start = Number(startStr);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
    return { status: 'unsatisfiable' };
  }

  let end = endStr === '' ? size - 1 : Number(endStr);
  if (!Number.isSafeInteger(end) || end < start) return { status: 'unsatisfiable' };
  end = Math.min(end, size - 1);

  return { status: 'ok', range: { start, end } };
}
