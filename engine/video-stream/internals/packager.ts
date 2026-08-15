import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

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
  sourcePath: string;
  hlsDir: string;
  ffmpegBin: string;
  renditions: RenditionSpec[];
  timeoutMs?: number;
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
  const args: string[] = ['-y', '-i', job.sourcePath];

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
  return args;
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
      const ffprobeBin =
        item.job.ffmpegBin.endsWith('ffmpeg') || item.job.ffmpegBin.includes('ffmpeg')
          ? item.job.ffmpegBin.replace(/ffmpeg$/i, 'ffprobe')
          : `${item.job.ffmpegBin}-ffprobe`;
      const hasAudio = await hasAudioStream(ffprobeBin, item.job.sourcePath);
      await runCommand(
        item.job.ffmpegBin,
        buildArgs(item.job, hasAudio),
        item.job.hlsDir,
        this.timeoutMs || 60 * 60 * 1000,
      );
      item.resolve();
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running--;
      this.pump();
    }
  }
}
