import { describe, expect, it, vi } from "vitest";
import { setGenerationPhase } from "./generation-phase.js";

describe("setGenerationPhase", () => {
  it("does not throw when the phase update fails", async () => {
    const logError = vi.fn();
    const client = {
      generationRun: {
        update: vi.fn().mockRejectedValue(new Error("database unavailable"))
      }
    };

    await expect(
      setGenerationPhase(client, "run-1", "writing_notice", logError)
    ).resolves.toBeUndefined();

    expect(client.generationRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {
        phase: "writing_notice",
        phaseUpdatedAt: expect.any(Date)
      }
    });
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("ignores missing generation run ids", async () => {
    const client = {
      generationRun: {
        update: vi.fn()
      }
    };

    await setGenerationPhase(client, null, "queued");

    expect(client.generationRun.update).not.toHaveBeenCalled();
  });
});
