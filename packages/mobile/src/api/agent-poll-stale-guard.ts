export function shouldAcceptResponse(currentSeq: number, capturedSeq: number): boolean {
  return currentSeq === capturedSeq
}

export interface WorkerTranscriptIdentity {
  selectedWorkspaceId: string | null
  workerId: string | null
}

export function shouldResetWorkerTranscript(
  previous: WorkerTranscriptIdentity | null,
  next: WorkerTranscriptIdentity
): boolean {
  if (!previous) return true
  return (
    previous.selectedWorkspaceId !== next.selectedWorkspaceId || previous.workerId !== next.workerId
  )
}
