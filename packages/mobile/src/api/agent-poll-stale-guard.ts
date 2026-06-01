export function shouldAcceptResponse(currentSeq: number, capturedSeq: number): boolean {
  return currentSeq === capturedSeq
}
