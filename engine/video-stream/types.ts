export type VideoSource = 'FILE' | 'URL';
export type VideoStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface VideoEngineConfig {
  storageDir: string;
  signSecret: string;
  ffmpegBin?: string;
  signTtlSeconds?: number;
  maxBytes?: number;
  processSlots?: number;
  maxQueue?: number;
  proxyTimeoutMs?: number;
  renditions?: 2 | 3;
  keepSource?: boolean;
  /** Stream a remote URL straight into ffmpeg (stdin) so HLS segments are served as soon as
   *  the first ones land, instead of waiting for a full download + repackage (URL source only). */
  progressive?: boolean;
}

export interface Video {
  id: string;
  tenantId: string;
  title: string;
  source: VideoSource;
  sourceUrl: string | null;
  fileName: string | null;
  filePath: string | null;
  mimeType: string;
  sizeBytes: number;
  status: VideoStatus;
  attempt: number;
  hlsReady: boolean;
  readyAt: Date | null;
  errorMsg: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoCreateInput {
  id: string;
  tenantId: string;
  title: string;
  source: VideoSource;
  sourceUrl?: string | null;
  fileName?: string | null;
  filePath?: string | null;
  mimeType: string;
  sizeBytes: number;
}

export type VideoUpdatePatch = Partial<
  Pick<
    Video,
    | 'title'
    | 'sourceUrl'
    | 'fileName'
    | 'filePath'
    | 'mimeType'
    | 'sizeBytes'
    | 'status'
    | 'attempt'
    | 'hlsReady'
    | 'readyAt'
    | 'errorMsg'
  >
>;

export interface VideoStore {
  create(input: VideoCreateInput): Promise<Video>;
  get(tenantId: string, id: string): Promise<Video | null>;
  list(tenantId: string): Promise<Video[]>;
  update(id: string, patch: VideoUpdatePatch): Promise<Video>;
  findByStatus(status: VideoStatus): Promise<Video[]>;
  resetProcessing(): Promise<void>;
  remove(tenantId: string, id: string): Promise<void>;
}

export class VideoEngineError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'VideoEngineError';
    this.code = code;
    this.status = status;
  }
}
