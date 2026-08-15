import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
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

async function hasAudioStream(ffprobeBin: string, sourcePath: string): Promise<boolean> {
  return runCommand(
    ffprobeBin,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      sourcePath,
    ],
    dirname(sourcePath),
    15000,
  )
    .then(() => true)
    .catch(() => false);
}

function buildArgs(job: PackageJob, hasAudio: boolean): string[] {
  const count = job.renditions.length;
  const args: string[] = [
    '-y',
    '-i',
    job.stdin ? 'pipe:0' : (job.sourcePath ?? 'pipe:0'),
  ];

  for (let i = 0; i < count; i++) {
    args.push('-map', '0:v:0');
    if (hasAudio) args.push('-map', '0:a:0');
  }

  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-g', '48', '-sc_threshold', '0');
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');

  job.renditions.forEach((r, i) => {
    args.push(
      `-b:v:${i}`,
      `${r.bandwidth}k`,
      `-maxrate:v:${i}`,
      `${r.maxrate}k`,
      `-bufsize:v:${i}`,
      `${r.bufsize}k`,
      `-vf:v:${i}`,
      `scale=-2:${r.height}`,
    );
  });

  const groups = job.renditions.map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`));
  args.push('-var_stream_map', groups.join(' '));
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
      const timeoutMs = this.timeoutMs || 60 * 60 * 1000;
      if (job.stdin) {
        await this.runProgressive(job, timeoutMs);
      } else {
        const ffprobeBin =
          job.ffmpegBin.endsWith('ffmpeg') || job.ffmpegBin.includes('ffmpeg')
            ? job.ffmpegBin.replace(/ffmpeg$/i, 'ffprobe')
            : `${job.ffmpegBin}-ffprobe`;
        const hasAudio = await hasAudioStream(ffprobeBin, job.sourcePath as string);
        await runCommand(job.ffmpegBin, buildArgs(job, hasAudio), job.hlsDir, timeoutMs);
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
    const child = spawn(job.ffmpegBin, buildArgs(job, true), {
      cwd: job.hlsDir,
      stdio: ['pipe', 'inherit', 'pipe'],
    });
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
