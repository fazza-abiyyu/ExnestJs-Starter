import type {
  StreamDocument,
  StreamDocumentCreateInput,
  StreamDocumentUpdatePatch,
  DocumentStore,
  PdfStatus,
} from '../types.js';

/** Structural subset of PrismaClient.streamDocument, so the adapter never depends on a generated client. */
export type StreamDocumentPrismaModel = {
  streamDocument: {
    create: (args: any) => Promise<unknown>;
    findFirst: (args: any) => Promise<unknown>;
    findMany: (args?: any) => Promise<unknown>;
    update: (args: any) => Promise<unknown>;
    updateMany: (args: any) => Promise<unknown>;
    deleteMany: (args: any) => Promise<unknown>;
  };
};

type PrismaStreamDocument = {
  id: string;
  tenantId: string;
  name: string;
  source: string;
  sourceUrl: string | null;
  fileName: string | null;
  filePath: string | null;
  watermark: string | null;
  pageCount: number;
  status: string;
  attempt: number;
  readyAt: Date | null;
  errorMsg: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapDocument(row: PrismaStreamDocument): StreamDocument {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    source: row.source === 'DRIVE' ? 'DRIVE' : 'FILE',
    sourceUrl: row.sourceUrl,
    fileName: row.fileName,
    filePath: row.filePath,
    watermark: row.watermark,
    pageCount: row.pageCount,
    status: toStatus(row.status),
    attempt: row.attempt,
    readyAt: row.readyAt,
    errorMsg: row.errorMsg,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStatus(raw: string): PdfStatus {
  if (raw === 'ready' || raw === 'failed' || raw === 'processing') return raw;
  return 'pending';
}

export class PrismaDocumentStore implements DocumentStore {
  constructor(private readonly prisma: StreamDocumentPrismaModel) {}

  async create(input: StreamDocumentCreateInput): Promise<StreamDocument> {
    const row = await this.prisma.streamDocument.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        name: input.name,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        fileName: input.fileName ?? null,
        filePath: input.filePath ?? null,
        watermark: input.watermark ?? null,
      },
    });
    return mapDocument(row as PrismaStreamDocument);
  }

  async get(tenantId: string, id: string): Promise<StreamDocument | null> {
    const row = await this.prisma.streamDocument.findFirst({ where: { id, tenantId } });
    return row ? mapDocument(row as PrismaStreamDocument) : null;
  }

  async getById(id: string): Promise<StreamDocument | null> {
    const row = await this.prisma.streamDocument.findFirst({ where: { id } });
    return row ? mapDocument(row as PrismaStreamDocument) : null;
  }

  async list(tenantId: string): Promise<StreamDocument[]> {
    const rows = await this.prisma.streamDocument.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return (rows as PrismaStreamDocument[]).map(mapDocument);
  }

  async update(id: string, patch: StreamDocumentUpdatePatch): Promise<StreamDocument> {
    const row = await this.prisma.streamDocument.update({
      where: { id },
      data: patch as never,
    });
    return mapDocument(row as PrismaStreamDocument);
  }

  async findByStatus(status: PdfStatus): Promise<StreamDocument[]> {
    const rows = await this.prisma.streamDocument.findMany({ where: { status } });
    return (rows as PrismaStreamDocument[]).map(mapDocument);
  }

  async resetProcessing(): Promise<void> {
    await this.prisma.streamDocument.updateMany({
      where: { status: 'processing' },
      data: { status: 'pending' },
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.streamDocument.deleteMany({ where: { id, tenantId } });
  }
}
