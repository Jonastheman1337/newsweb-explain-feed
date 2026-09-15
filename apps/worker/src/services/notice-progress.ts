import type { GenerationPhase } from "@newsweb/shared";

// One instance per full generation. Fast drafts never share these counters.
export function createNoticeProgress(emit: (phase: GenerationPhase) => Promise<void>) {
  let writes = 0;
  let checks = 0;
  let lastPhase: GenerationPhase | undefined;
  async function phase(value: GenerationPhase) {
    if (value === lastPhase) return;
    await emit(value);
    lastPhase = value;
  }
  async function run<T>(value: GenerationPhase, work: () => Promise<T>): Promise<T> {
    await phase(value);
    return work();
  }
  return {
    phase,
    run,
    writer<A extends unknown[], R>(write: (...args: A) => Promise<R>) {
      return (...args: A) => run(writes++ === 0 ? "writing_notice" : "correcting_notice", () => write(...args));
    },
    check<T>(work: () => Promise<T>) {
      return run(checks++ === 0 ? "checking_references" : "rechecking_references", work);
    }
  };
}
export type NoticeProgress = ReturnType<typeof createNoticeProgress>;
