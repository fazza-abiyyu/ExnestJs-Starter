import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

export interface RenditionSpec {
  height: number;
  width: number;
  bandwidth: number;
  maxrate: number;
  bufsize: number;
}

export const RENDITIONS_3: RenditionSpec[] = [
  { height: 1080, width: 1920, bandwidth: 5000, maxrate: 5350, bufsize: 7500 },
  { height: 720, width: 1280, bandwidth: 2800, maxrate: 2996, bufsize: 4200 },
  { height: 480, width: 854, bandwidth: 1400, maxrate: 1498, bufsize: 2100 },
];

export const RENDITIONS_2: RenditionSpec[] = [
  { height: 720, width: 1280, bandwidth: 2800, maxrate: 2996, bufsize: 4200 },
  { height: 480, width: 854, bandwidth: 1400, maxrate: 1498, bufsize: 2100 },
];

export interface PackageJob {
  sourcePath?: string;
  hlsDir: string;
  ffmpegBin: string;
  renditions: RenditionSpec[];
  timeoutMs?: number;
  /** Progressive: feed ffmpeg from this stream instead of a local file. */
  stdin?: ReadableStream<Uint8Array>;
  /** Abort (kill ffmpeg) once more than this many bytes were pumped. */
  maxBytes?: number;
}

function runCommand(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `command exited with code ${code}`));
    });
  });
}

export interface SourceMeta {
  hasAudio: boolean;
  vcodec: string;
  width: number;
  height: number;
}

async function probeSource(ffprobeBin: string, sourcePath: string): Promise<SourceMeta> {
  const probe = new Promise<string>((resolve, reject) => {
    const child: ReturnType<typeof spawn> = spawn(
      ffprobeBin,
      [
        '-v',
        'error',
        '-show_streams',
        '-show_entries',
        'stream=index,codec_type,codec_name,width,height',
        '-of',
        'json',
        sourcePath,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `ffprobe exited with code ${code}`));
    });
  });
  const parsed = JSON.parse(await probe) as {
    streams?: Array<{
      index: number;
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
    }>;
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  return {
    hasAudio: Boolean(audio),
    vcodec: video?.codec_name ?? '',
    width: video?.width ?? 0,
    height: video?.height ?? 0,
  };
}

function buildArgs(job: PackageJob, meta: SourceMeta): string[] {
  const count = job.renditions.length;
  const hasAudio = meta.hasAudio;
  const args: string[] = [
    '-y',
    '-i',
    job.stdin ? 'pipe:0' : (job.sourcePath ?? 'pipe:0'),
  ];

  const copyIndex =
    !job.stdin &&
    meta.vcodec.toLowerCase().startsWith('avc') &&
    meta.height > 0 &&
    job.renditions[0].height === meta.height
      ? 0
      : -1;

  const filters: string[] = [];
  const videoLabels: string[] = [];
  job.renditions.forEach((r, i) => {
    if (i === copyIndex) {
      videoLabels.push('0:v:0');
      return;
    }
    const label = `v${i}`;
    videoLabels.push(`[${label}]`);
    filters.push(`[0:v:0]scale=-2:${r.height},fps=30[${label}]`);
  });
  if (filters.length > 0) {
    args.push('-filter_complex', filters.join(';'));
  }

  job.renditions.forEach((r, i) => {
    args.push('-map', videoLabels[i]);
    if (hasAudio) args.push('-map', '0:a:0');
  });

  job.renditions.forEach((_, i) => {
    args.push(`-c:v:${i}`, i === copyIndex ? 'copy' : 'libx264');
    if (hasAudio) args.push(`-c:a:${i}`, i === copyIndex ? 'copy' : 'aac');
  });
  args.push('-preset', 'veryfast', '-g', '48', '-sc_threshold', '0', '-threads', '3');
  if (hasAudio) {
    args.push('-ac', '2');
    for (let i = 0; i < count; i++) args.push(`-b:a:${i}`, '128k');
  }

  job.renditions.forEach((r, i) => {
    if (i === copyIndex) return;
    args.push(
      `-b:v:${i}`,
      `${r.bandwidth}k`,
      `-maxrate:v:${i}`,
      `${r.maxrate}k`,
      `-bufsize:v:${i}`,
      `${r.bufsize}k`,
    );
  });

  const groups = job.renditions.map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`));
  args.push('-var_stream_map', groups.join(' '), '-max_muxing_queue_size', '1024');
  args.push(
    '-master_pl_name',
    'master.m3u8',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_playlist_type',
    'vod',
    '-hls_segment_filename',
    '%v/segment_%05d.ts',
    '%v/index.m3u8',
  );
  if (job.stdin) {
    args.push('-hls_flags', 'temp_file+independent_segments');
  }
  return args;
}

function pipeStreamInto(
  child: ReturnType<typeof spawn>,
  web: ReadableStream<Uint8Array>,
  maxBytes: number | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const node = Readable.fromWeb(web as never);
    const stdin = child.stdin;
    let total = 0;
    node.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (maxBytes != null && total > maxBytes) {
        node.destroy();
        child.kill('SIGKILL');
        reject(new Error(`payload exceeds ${maxBytes} bytes`));
      }
    });
    node.on('error', (err) => {
      child.kill('SIGKILL');
      reject(err);
    });
    node.on('end', () => resolve());
    if (stdin) node.pipe(stdin);
    else node.resume();
  });
}

export class Packager {
  private readonly queue: {
    job: PackageJob;
    resolve: () => void;
    reject: (err: Error) => void;
  }[] = [];
  private running = 0;
  private readonly maxSlots: number;
  private readonly timeoutMs: number;

  constructor(maxSlots = 1, timeoutMs = 0) {
    this.maxSlots = Math.max(1, Math.floor(maxSlots));
    this.timeoutMs = timeoutMs > 0 ? timeoutMs : 0;
  }

  get pending() {
    return this.queue.length;
  }

  enqueue(job: PackageJob): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
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
    job: PackageJob;
    resolve: () => void;
    reject: (err: Error) => void;
  }): Promise<void> {
    this.running++;
    try {
      const job = item.job;
      const timeoutMs = job.timeoutMs ?? (this.timeoutMs || 60 * 60 * 1000);
      if (job.stdin) {
        await this.runProgressive(job, timeoutMs);
      } else {
        const ffprobeBin =
          job.ffmpegBin.endsWith('ffmpeg') || job.ffmpegBin.includes('ffmpeg')
            ? job.ffmpegBin.replace(/ffmpeg$/i, 'ffprobe')
            : `${job.ffmpegBin}-ffprobe`;
        const meta = await probeSource(ffprobeBin, job.sourcePath as string).catch(() => ({
          hasAudio: false,
          vcodec: '',
          width: 0,
          height: 0,
        }));
        await runCommand(job.ffmpegBin, buildArgs(job, meta), job.hlsDir, timeoutMs);
      }
      item.resolve();
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running--;
      this.pump();
    }
  }

  /** Stream a remote body straight through ffmpeg on stdin. Progressive inputs can't be
   *  probed up-front, so audio is assumed present; the byte cap kills the job when the
   *  source out-grows `maxBytes`. */
  private async runProgressive(job: PackageJob, timeoutMs: number): Promise<void> {
    const child = spawn(
      job.ffmpegBin,
      buildArgs(job, { hasAudio: true, vcodec: '', width: 0, height: 0 }),
      {
        cwd: job.hlsDir,
        stdio: ['pipe', 'inherit', 'pipe'],
      },
    );
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      child.on('error', (err) => settle(err));
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', (code) => {
        if (code === 0) settle();
        else settle(new Error(stderr.trim() || `command exited with code ${code}`));
      });
      const pump = pipeStreamInto(child, job.stdin as ReadableStream<Uint8Array>, job.maxBytes);
      pump.catch((err) => {
        settle(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
}
