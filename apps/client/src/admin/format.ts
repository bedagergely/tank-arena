export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** V8 profiles time everything in microseconds. */
export function formatMicros(micros: number): string {
  const ms = micros / 1000;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/**
 * Per-call figures are routinely well under a millisecond, where the coarse
 * formatter above would just render "0 ms".
 */
export function formatMicrosFine(micros: number): string {
  if (micros < 1) return `${micros.toFixed(2)} µs`;
  if (micros < 1000) return `${micros.toFixed(micros < 10 ? 1 : 0)} µs`;
  if (micros < 1_000_000) return `${(micros / 1000).toFixed(micros < 10_000 ? 1 : 0)} ms`;
  return `${(micros / 1_000_000).toFixed(2)} s`;
}

/** Trims a script URL down to something that fits in a table cell. */
export function shortenPath(url: string, max = 52): string {
  const path = url.replace(/^file:\/\//, "");
  return path.length <= max ? path : `…${path.slice(path.length - max)}`;
}

/**
 * Heap node names can be entire source strings or string contents, so anything
 * long enough to wreck the layout is cut down.
 */
export function truncate(text: string, max = 72): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max)}…`;
}


