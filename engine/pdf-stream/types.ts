export type PdfSource = 'FILE' | 'DRIVE';
export type PdfStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface PdfEngineConfig {
  storageDir: string;
  signSecret: string;
  signTtlSeconds?: number;
  maxBytes?: number;
  processSlots?: number;
  maxQueue?: number;
  proxyTimeoutMs?: number;
  rasterScale?: number;
}

export interface StreamDocument {
  id: string;
  tenantId: string;
  name: string;
  source: PdfSource;
  sourceUrl: string | null;
  fileName: string | null;
  filePath: string | null;
  watermark: string | null;
  pageCount: number;
  status: PdfStatus;
  attempt: number;
  readyAt: Date | null;
  errorMsg: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StreamDocumentCreateInput {
  id: string;
  tenantId: string;
  name: string;
  source: PdfSource;
  sourceUrl?: string | null;
  fileName?: string | null;
  filePath?: string | null;
  watermark?: string | null;
}

export type StreamDocumentUpdatePatch = Partial<
  Pick<
    StreamDocument,
    | 'name'
    | 'sourceUrl'
    | 'fileName'
    | 'filePath'
    | 'watermark'
    | 'pageCount'
    | 'status'
    | 'attempt'
    | 'readyAt'
    | 'errorMsg'
  >
>;

export interface DocumentStore {
  create(input: StreamDocumentCreateInput): Promise<StreamDocument>;
  get(tenantId: string, id: string): Promise<StreamDocument | null>;
  getById(id: string): Promise<StreamDocument | null>;
  list(tenantId: string): Promise<StreamDocument[]>;
  update(id: string, patch: StreamDocumentUpdatePatch): Promise<StreamDocument>;
  findByStatus(status: PdfStatus): Promise<StreamDocument[]>;
  resetProcessing(): Promise<void>;
  remove(tenantId: string, id: string): Promise<void>;
}

export class PdfEngineError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'PdfEngineError';
    this.code = code;
    this.status = status;
  }
}
