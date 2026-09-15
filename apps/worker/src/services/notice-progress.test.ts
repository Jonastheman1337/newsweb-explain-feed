import { describe, expect, it, vi } from "vitest";
import { createNoticeProgress } from "./notice-progress.js";
describe("notice operation progress", () => {
  it("reports actual writing, repair and check operations in order without changing inputs or results", async () => {
    const events: string[] = [];
    const progress = createNoticeProgress(async phase => { events.push(phase); });
    const model = vi.fn(async (text: string) => { events.push("model:" + text); return text + "!"; });
    const write = progress.writer(model);
    expect(await write("first")).toBe("first!");
    await progress.check(async () => { events.push("check:first"); });
    expect(await write("correction")).toBe("correction!");
    await progress.check(async () => { events.push("check:corrected"); });
    await progress.phase("finalizing");
    await progress.phase("publishing");
    expect(events).toEqual(["writing_notice", "model:first", "checking_references", "check:first", "correcting_notice", "model:correction", "rechecking_references", "check:corrected", "finalizing", "publishing"]);
    expect(model.mock.calls).toEqual([["first"], ["correction"]]);
  });
  it("does not announce skipped operations or invent progress while a call is pending", async () => {
    const emit = vi.fn(async () => {});
    const progress = createNoticeProgress(emit);
    let finish!: (value: string) => void;
    const write = progress.writer(() => new Promise<string>(resolve => { finish = resolve; }));
    const pending = write();
    await Promise.resolve(); await Promise.resolve();
    expect(emit.mock.calls).toEqual([["writing_notice"]]);
    finish("done"); expect(await pending).toBe("done");
    expect(emit.mock.calls).toEqual([["writing_notice"]]);
  });
  it("keeps concurrent full generations independent", async () => {
    const a = vi.fn(async () => {}), b = vi.fn(async () => {});
    const one = createNoticeProgress(a), two = createNoticeProgress(b);
    const writeOne = one.writer(async () => 1), writeTwo = two.writer(async () => 2);
    await Promise.all([writeOne(), writeTwo()]);
    await writeOne(); await one.check(async () => {}); await one.check(async () => {});
    expect(a.mock.calls).toEqual([["writing_notice"], ["correcting_notice"], ["checking_references"], ["rechecking_references"]]);
    expect(b.mock.calls).toEqual([["writing_notice"]]);
  });
  it("reports lookup only when invoked and suppresses repeated identical status events", async () => {
    const emit = vi.fn(async () => {}), lookup = vi.fn(async () => "source");
    const progress = createNoticeProgress(emit);
    expect(emit).not.toHaveBeenCalled();
    await progress.run("loading_context", lookup); await progress.run("loading_context", lookup);
    expect(emit.mock.calls).toEqual([["loading_context"]]); expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("preserves failures and cancellation without starting extra model calls", async () => {
    const error = new Error("model failure");
    const model = vi.fn(async () => { throw error; });
    const progress = createNoticeProgress(async () => {});
    await expect(progress.writer(model)()).rejects.toBe(error); expect(model).toHaveBeenCalledTimes(1);
    const cancelled = createNoticeProgress(async () => { throw new Error("cancelled"); });
    await expect(cancelled.writer(model)()).rejects.toThrow("cancelled"); expect(model).toHaveBeenCalledTimes(1);
  });
});
