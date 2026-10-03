/** The slice of the D1 / R2 bindings the sync and credits code relies on. */

export interface D1Result {
  meta?: { changes?: number }
}

export interface D1Statement {
  bind(...args: unknown[]): D1Statement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<D1Result>
}

export interface D1Like {
  prepare(sql: string): D1Statement
  /** Executes in order inside one implicit transaction. */
  batch(statements: D1Statement[]): Promise<D1Result[]>
}

export interface R2ObjectBodyLike {
  body: ReadableStream | Uint8Array | string
}

export interface R2Like {
  get(key: string): Promise<R2ObjectBodyLike | null>
  put(key: string, body: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  delete(key: string | string[]): Promise<unknown>
}

export const changes = (r: D1Result | undefined): number => r?.meta?.changes ?? 0
