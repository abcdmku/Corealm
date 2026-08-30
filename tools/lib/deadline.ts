/** Hard ceiling for test commands so compounded browser waits cannot turn into hour-long jobs. */
export const TEST_LOOP_DEADLINE_MS = 270_000;

export function installTestDeadline(label: string, timeoutMs = TEST_LOOP_DEADLINE_MS): () => void {
  const timer = setTimeout(() => {
    console.error(`${label} exceeded ${Math.round(timeoutMs / 1000)} seconds; split the test into focused shards.`);
    process.exit(124);
  }, timeoutMs);
  timer.unref();
  return () => clearTimeout(timer);
}
