import { AsyncLocalStorage } from "node:async_hooks";

// A worker can process several notices concurrently. Cancellation must follow
// one asynchronous run, never a process-wide "current job" variable.
const generationSignal = new AsyncLocalStorage<AbortSignal>();
export function withGenerationSignal<T>(
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  return generationSignal.run(signal, run);
}
export function currentGenerationSignal(): AbortSignal | undefined {
  return generationSignal.getStore();
}
export function throwIfGenerationCancelled(): void {
  currentGenerationSignal()?.throwIfAborted();
}
export function generationRequestSignal(
  timeoutMs: number,
  signal?: AbortSignal,
): AbortSignal {
  const signals = [
    AbortSignal.timeout(timeoutMs),
    signal,
    currentGenerationSignal(),
  ].filter((value): value is AbortSignal => value != null);
  return AbortSignal.any(signals);
}
