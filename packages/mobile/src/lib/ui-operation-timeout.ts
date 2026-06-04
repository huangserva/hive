export class UiOperationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`)
    this.name = 'UiOperationTimeoutError'
  }
}

export const DEFAULT_UI_OPERATION_TIMEOUT_MS = 15_000

export function withUiOperationTimeout<T>(
  operation: Promise<T>,
  options: { label: string; timeoutMs?: number }
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_UI_OPERATION_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  const guardedOperation = operation.finally(() => {
    if (timer) clearTimeout(timer)
  })
  guardedOperation.catch(() => {
    // The timeout may win the race; absorb late operation failures so a stale
    // request cannot surface as an unhandled rejection after the UI has recovered.
  })
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new UiOperationTimeoutError(options.label, timeoutMs)),
      timeoutMs
    )
  })
  return Promise.race([guardedOperation, timeout])
}

export async function runUiOperationSafely<T>(
  operation: Promise<T>,
  options: { label: string; timeoutMs?: number }
): Promise<{ error?: unknown; ok: boolean; value?: T }> {
  try {
    const value = await withUiOperationTimeout(operation, options)
    return { ok: true, value }
  } catch (error) {
    return { error, ok: false }
  }
}
