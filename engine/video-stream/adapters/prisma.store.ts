import type { Video, VideoCreateInput, VideoStore, VideoUpdatePatch } from '../types.js';

/** Structural subset of PrismaClient.video, so the adapter never depends on a generated client. */
export type VideoPrismaModel = {
  video: {
    create: (args: any) => Promise<unknown>;
    findFirst: (args: any) => Promise<unknown>;
    findMany: (args?: any) => Promise<unknown>;
    update: (args: any) => Promise<unknown>;
    updateMany: (args: any) => Promise<unknown>;
    deleteMany: (args: any) => Promise<unknown>;
  };
};

type PrismaVideo = {
  id: string;
  tenantId: string;
  title: string;
  source: string;
  sourceUrl: string | null;
  fileName: string | null;
  filePath: string | null;
  mimeType: string;
  sizeBytes: number;
  status: string;
  attempt: number;
  hlsReady: boolean;
  readyAt: Date | null;
  errorMsg: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapVideo(row: PrismaVideo): Video {
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    source: row.source === 'URL' ? 'URL' : 'FILE',
    sourceUrl: row.sourceUrl,
    fileName: row.fileName,
    filePath: row.filePath,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status:
      row.status === 'ready'
        ? 'ready'
        : row.status === 'failed'
          ? 'failed'
          : row.status === 'processing'
            ? 'processing'
            : 'pending',
    attempt: row.attempt,
    hlsReady: row.hlsReady,
    readyAt: row.readyAt,
    errorMsg: row.errorMsg,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaVideoStore implements VideoStore {
  constructor(private readonly prisma: VideoPrismaModel) {}

  async create(input: VideoCreateInput): Promise<Video> {
    const row = await this.prisma.video.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        title: input.title,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        fileName: input.fileName ?? null,
        filePath: input.filePath ?? null,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
    });
    return mapVideo(row as PrismaVideo);
  }

  async get(tenantId: string, id: string): Promise<Video | null> {
    const row = await this.prisma.video.findFirst({ where: { id, tenantId } });
    return row ? mapVideo(row as PrismaVideo) : null;
  }

  async list(tenantId: string): Promise<Video[]> {
    const rows = await this.prisma.video.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return (rows as PrismaVideo[]).map(mapVideo);
  }

  async update(id: string, patch: VideoUpdatePatch): Promise<Video> {
    const row = await this.prisma.video.update({
      where: { id },
      data: patch as never,
    });
    return mapVideo(row as PrismaVideo);
  }

  async findByStatus(status: Video['status']): Promise<Video[]> {
    const rows = await this.prisma.video.findMany({ where: { status } });
    return (rows as PrismaVideo[]).map(mapVideo);
  }

  async resetProcessing(): Promise<void> {
    await this.prisma.video.updateMany({
      where: { status: 'processing' },
      data: { status: 'pending' },
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.video.deleteMany({ where: { id, tenantId } });
  }
}
