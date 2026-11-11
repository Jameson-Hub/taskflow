import { useEffect, useState, type ReactNode } from "react";
import { PRIORITIES, STATUSES, type Stats } from "../shared/domain";
import { api, PRIORITY_LABEL, STATUS_LABEL } from "./api";
import { ErrorText, LabelChip, localToday, useAction } from "./ui";

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const { error, run } = useAction();

  useEffect(() => {
    run(async () => setStats(await api.stats(localToday())));
  }, [run]);

  if (!stats) return <ErrorText error={error} />;

  const total = stats.open + stats.done;
  const busiest = Math.max(1, ...stats.workload.map((w) => w.open));

  return (
    <section className="page dashboard">
      <h1>Dashboard</h1>
      <ErrorText error={error} />

      <div className="kpis">
        <Kpi label="Open" value={stats.open} />
        <Kpi label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? "late" : undefined} />
        <Kpi label="Due this week" value={stats.due_soon} />
        <Kpi label="Done" value={stats.done} />
      </div>

      {total === 0 ? (
        <p className="muted">No tasks yet. Add some on the board and they'll show up here.</p>
      ) : (
        <div className="charts">
          <Chart title="Tasks by status">
            {STATUSES.map((s) => (
              <Bar key={s} label={STATUS_LABEL[s]} value={stats.by_status[s]} max={total} />
            ))}
          </Chart>

          <Chart title="Open tasks by priority">
            {PRIORITIES.map((p) => (
              <Bar key={p} label={PRIORITY_LABEL[p]} value={stats.by_priority[p]} max={Math.max(1, stats.open)} />
            ))}
          </Chart>

          <Chart
            title="Open tasks per person"
            legend={
              <span className="legend">
                <span className="swatch" /> On time <span className="swatch overdue" /> Overdue
              </span>
            }
          >
            {stats.workload.length === 0 && <p className="muted small">Nothing open.</p>}
            {stats.workload.map((w) => (
              <Bar key={w.id ?? "none"} label={w.name} value={w.open} overdue={w.overdue} max={busiest} />
            ))}
          </Chart>

          <Chart title="Most used labels">
            {stats.labels.length === 0 && <p className="muted small">No labels yet.</p>}
            {stats.labels.map((l) => (
              <Bar key={l.name} label={<LabelChip name={l.name} />} name={l.name} value={l.count} max={stats.labels[0]!.count} />
            ))}
          </Chart>
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "late" }) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">
        {tone === "late" && <span aria-hidden="true">⚠ </span>}
        {label}
      </span>
    </div>
  );
}

function Chart({ title, legend, children }: { title: string; legend?: ReactNode; children: ReactNode }) {
  return (
    <figure className="chart">
      <figcaption>
        <h2>{title}</h2>
        {legend}
      </figcaption>
      <div className="bars">{children}</div>
    </figure>
  );
}

/** One row: label, a bar scaled to `max`, and the number. An overdue share is drawn as its own segment. */
function Bar({ label, name, value, max, overdue = 0 }: { label: ReactNode; name?: string; value: number; max: number; overdue?: number }) {
  const width = (n: number) => `${(n / max) * 100}%`;
  const tip = overdue ? `${value} open, ${overdue} overdue` : String(value);
  return (
    <div className="bar-row" title={`${name ?? label}: ${tip}`}>
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        {value - overdue > 0 && <span className="bar-fill" style={{ width: width(value - overdue) }} />}
        {overdue > 0 && <span className="bar-fill overdue" style={{ width: width(overdue) }} />}
      </span>
      <span className="bar-value">
        {value}
        {overdue > 0 && <span className="late"> · {overdue} overdue</span>}
      </span>
    </div>
  );
}
