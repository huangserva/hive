export type WebRtcConnectionProbeSession = {
  callId: string
  close: () => void
  waitForConnected: (timeoutMs?: number) => Promise<void>
}

export type WebRtcConnectionProbeResult =
  | { callId: string; ok: true }
  | { callId?: string; ok: false; reason: string }

const describeError = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

export const runWebRtcConnectionProbeSession = async (
  startSession: () => Promise<WebRtcConnectionProbeSession>,
  timeoutMs = 15_000
): Promise<WebRtcConnectionProbeResult> => {
  let session: WebRtcConnectionProbeSession | null = null
  try {
    session = await startSession()
    await session.waitForConnected(timeoutMs)
    return { callId: session.callId, ok: true }
  } catch (error) {
    return {
      ...(session ? { callId: session.callId } : {}),
      ok: false,
      reason: describeError(error),
    }
  } finally {
    session?.close()
  }
}
