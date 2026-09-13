// VA-ORM Query Events

export type EventType = 'query' | 'error' | 'info' | 'warn'

export interface QueryEvent {
  type: 'query'
  model: string
  action: string
  query: string
  params: any[]
  duration: number
  timestamp: Date
  result?: any
}

export interface ErrorEvent {
  type: 'error'
  model: string
  action: string
  query: string
  params: any[]
  message: string
  stack?: string
  timestamp: Date
}

export interface InfoEvent {
  type: 'info'
  message: string
  timestamp: Date
}

export interface WarnEvent {
  type: 'warn'
  message: string
  timestamp: Date
}

export type EventData = QueryEvent | ErrorEvent | InfoEvent | WarnEvent

export type EventListener<T extends EventData = EventData> = (event: T) => void

export class EventEmitter {
  private listeners = new Map<string, Set<EventListener>>()

  on<T extends EventData = EventData>(event: T['type'], listener: EventListener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener as unknown as EventListener)

    return () => {
      this.off(event, listener)
    }
  }

  off(event: string, listener: EventListener<any>): void {
    const set = this.listeners.get(event)
    if (set) {
      set.delete(listener)
      if (set.size === 0) {
        this.listeners.delete(event)
      }
    }
  }

  emit(event: EventData): void {
    const set = this.listeners.get(event.type)
    if (set) {
      for (const listener of set) {
        try {
          listener(event)
        } catch {
          // Silently ignore listener errors
        }
      }
    }
  }

  emitQuery(
    model: string,
    action: string,
    query: string,
    params: any[],
    duration: number,
    result?: any
  ): void {
    this.emit({
      type: 'query',
      model,
      action,
      query,
      params,
      duration,
      timestamp: new Date(),
      result,
    })
  }

  emitError(
    model: string,
    action: string,
    query: string,
    params: any[],
    message: string,
    stack?: string
  ): void {
    this.emit({
      type: 'error',
      model,
      action,
      query,
      params,
      message,
      stack,
      timestamp: new Date(),
    })
  }

  emitInfo(message: string): void {
    this.emit({
      type: 'info',
      message,
      timestamp: new Date(),
    })
  }

  emitWarn(message: string): void {
    this.emit({
      type: 'warn',
      message,
      timestamp: new Date(),
    })
  }
}
