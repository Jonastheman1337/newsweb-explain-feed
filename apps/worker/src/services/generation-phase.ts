import type { GenerationPhase } from "@newsweb/shared";

type GenerationPhaseClient = {
  generationRun: {
    update(args: {
      where: { id: string };
      data: { phase: GenerationPhase; phaseUpdatedAt: Date };
    }): Promise<unknown>;
  };
};

type PhaseLogger = (message: string) => void;

export async function setGenerationPhase(
  client: GenerationPhaseClient,
  generationRunId: string | null | undefined,
  phase: GenerationPhase,
  logError: PhaseLogger = console.warn
): Promise<void> {
  if (!generationRunId) {
    return;
  }

  try {
    await client.generationRun.update({
      where: { id: generationRunId },
      data: {
        phase,
        phaseUpdatedAt: new Date()
      }
    });
  } catch (error) {
    logError(
      JSON.stringify({
        service: "worker",
        event: "generation_phase_update_failed",
        generationRunId,
        phase,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
}
