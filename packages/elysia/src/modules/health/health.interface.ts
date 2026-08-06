export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unavailable'
  service: string
  version: string
  checks: Record<string, unknown>
  observed_at: string
}

export interface ResponseMeta {
  correlation_id: string | null
  request_id: string | null
  idempotency_replayed: boolean
  served_at: string
}

export interface HealthResponse {
  data: HealthStatus
  meta: ResponseMeta
}

export interface HealthCheckOptions {
  lang?: string
  simulate?: string
  correlationId?: string
}
