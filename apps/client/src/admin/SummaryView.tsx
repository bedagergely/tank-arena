import type { ProfileSummary } from "./summarize.ts";

export interface InspectState {
  loading: boolean;
  summary: ProfileSummary | null;
  error: string | null;
}

/** Renders a parsed profile: headline stats plus a ranked list per section. */
export function SummaryView({ state }: { state: InspectState }) {
  if (state.error !== null) return <p className="m-0 text-sm text-error">{state.error}</p>;
  if (state.loading || state.summary === null) {
    return <p className="m-0 text-sm text-base-content/60">Reading and parsing the profile…</p>;
  }

  const { stats, sections, note } = state.summary;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {stats.map((stat) => (
          <span key={stat.label}>
            <span className="text-base-content/60">{stat.label}</span>{" "}
            <span className="font-semibold tabular-nums">{stat.value}</span>
          </span>
        ))}
      </div>

      {sections.map((section) => (
        <div key={section.title}>
          <h3 className="m-0 mb-1 text-sm font-semibold text-base-content/80">{section.title}</h3>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-base-content/40">
                <th className="w-6 font-normal" />
                <th className="font-normal" />
                <th className="w-24 py-1 pr-2 text-right font-normal">{section.valueLabel}</th>
                <th className="w-14 py-1 text-right font-normal">%</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, index) => (
                <tr key={`${row.name}|${row.detail}`} className="border-b border-base-300/40 last:border-0">
                  <td className="w-6 py-1 pr-2 text-right text-base-content/40 tabular-nums">{index + 1}</td>
                  <td className="py-1 pr-2">
                    <span className="font-mono">{row.name}</span>
                    <span className="ml-2 text-base-content/50">{row.detail}</span>
                  </td>
                  <td className="w-24 py-1 pr-2 text-right tabular-nums">{row.value}</td>
                  <td className="w-14 py-1 text-right text-base-content/60 tabular-nums">
                    {(row.share * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
              {section.rows.length === 0 && (
                <tr>
                  <td className="py-1 text-base-content/50" colSpan={4}>
                    Nothing recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}

      <p className="m-0 text-xs text-base-content/50">{note}</p>
    </div>
  );
}
