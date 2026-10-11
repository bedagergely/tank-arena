/**
 * Bands for colouring the ping readout. Thresholds are about feel rather than
 * anything scientific: under ~80 ms is imperceptible, past ~200 ms you notice
 * the lag when driving.
 */
export function latencyTone(ms: number | null): string {
  if (ms === null) return "text-base-content/60";
  if (ms < 80) return "text-success";
  if (ms < 200) return "text-warning";
  return "text-error";
}

export function formatLatency(ms: number | null): string {
  return ms === null ? "—" : `${Math.round(ms)} ms`;
}
