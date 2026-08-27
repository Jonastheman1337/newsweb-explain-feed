export function canWriteRewriteCandidate(
  candidate: { status: string; generationRunId: string | null },
  generationRunId?: string
): boolean {
  return (
    candidate.status !== "published" &&
    (candidate.generationRunId === null ||
      candidate.generationRunId === (generationRunId ?? null))
  );
}
