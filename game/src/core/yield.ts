/**
 * Ends the current browser task without waiting for a timer clamp.
 *
 * `scheduler.yield()` continuations inherit the caller's priority. A long chain of them can starve
 * DevTools and input behind the continuation queue, which defeats the point of cooperative boot.
 * MessageChannel posts an ordinary task and is supported by every Chromium version this game runs.
 */
export function yieldToMainThread(): Promise<void> {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
