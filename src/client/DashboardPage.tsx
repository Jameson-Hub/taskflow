import { useEffect, useState, type ReactNode } from "react";
import { PRIORITIES, STALE_DAYS, STATUSES, TREND_WEEKS, UPCOMING_DAYS, type AttentionList, type Stats } from "../shared/domain";
import { api, PRIORITY_LABEL, STATUS_LABEL, type User } from "./api";
import { boardLink, dayOf, dueLabel, ErrorText, LabelChip, localToday, longDate, shortDate, useAction } from "./ui";

export function DashboardPage({ me }: { me: User }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState(false);
  const { error, run } = useAction();

  useEffect(() => {
    run(async () => setStats(await api.stats(localToday(), mine)));
  }, [run, mine]);

  if (!stats) return <ErrorText error={error} />;

  // With "Just my tasks" on, links keep that filter so the board shows what was counted.
  const link = (params: Record<string, string | number>) => boardLink(mine ? { assignee: me.id, ...params } : params);

  const total = stats.open + stats.done;
  const busiest = Math.max(1, ...stats.workload.map((w) => w.open));

  return (
    <section className="page dashboard">
      <header className="page-head">
        <h1>Dashboard</h1>
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Just my tasks
        </label>
      </header>
      <ErrorText error={error} />

      <div className="kpis">
        <Kpi label="Open" value={stats.open} />
        <Kpi label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? "late" : undefined} />
        <Kpi label="Due this week" value={stats.due_soon} />
        <Kpi label="Done" value={stats.done} />
        <Kpi label={`Avg. days to finish (${TREND_WEEKS} wk)`} value={stats.avg_days_to_done ?? "–"} />
      </div>

      {total === 0 ? (
        <p className="muted">
          {mine ? "Nothing is assigned to you yet." : "No tasks yet. Add some on the board and they'll show up here."}
        </p>
      ) : (
        <div className="charts">
          <Chart title="Needs attention">
            <AttentionTasks title="Overdue" list={stats.attention.overdue} showDue />
            <AttentionTasks title={`Untouched for ${STALE_DAYS} days`} list={stats.attention.stale} />
            {stats.attention.overdue.total + stats.attention.stale.total === 0 && <p className="muted small">All clear.</p>}
          </Chart>

          <Chart title={`Due in the next ${UPCOMING_DAYS} days`}>
            <ColumnStrip label="Tasks due each day" columns={upcomingColumns(stats.upcoming)} />
          </Chart>

          <Chart title={`Finished per week, last ${TREND_WEEKS} weeks`}>
            <ColumnStrip label="Tasks finished each week" columns={weeklyColumns(stats.completed)} />
          </Chart>

          <Chart title="Tasks by status">
            {STATUSES.map((s) => (
              <Bar key={s} label={STATUS_LABEL[s]} value={stats.by_status[s]} max={total} />
            ))}
          </Chart>

          <Chart title="Open tasks by priority">
            {[...PRIORITIES].reverse().map((p) => (
              <Bar
                key={p}
                label={PRIORITY_LABEL[p]}
                value={stats.by_priority[p]}
                max={Math.max(1, stats.open)}
                href={link({ priority: p })}
              />
            ))}
          </Chart>

          {!mine && (
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
                <Bar
                  key={w.id ?? "none"}
                  label={w.name}
                  value={w.open}
                  overdue={w.overdue}
                  max={busiest}
                  href={boardLink({ assignee: w.id ?? "none" })}
                />
              ))}
            </Chart>
          )}

          <Chart title="Most used labels">
            {stats.labels.length === 0 && <p className="muted small">No labels yet.</p>}
            {stats.labels.map((l) => (
              <Bar
                key={l.name}
                label={<LabelChip name={l.name} />}
                name={l.name}
                value={l.count}
                max={stats.labels[0]!.count}
                href={link({ label: l.name })}
              />
            ))}
          </Chart>
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: "late" }) {
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
interface BarProps {
  label: ReactNode;
  /** Text for the tooltip when the label isn't plain text. */
  name?: string;
  value: number;
  max: number;
  overdue?: number;
  /** Where clicking the row goes: the board, filtered to this row. */
  href?: string;
}

function Bar({ label, name, value, max, overdue = 0, href }: BarProps) {
  const width = (n: number) => `${(n / max) * 100}%`;
  const tip = overdue ? `${value} open, ${overdue} overdue` : String(value);
  return (
    <BarRow href={href} title={`${name ?? label}: ${tip}`}>
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        {value - overdue > 0 && <span className="bar-fill" style={{ width: width(value - overdue) }} />}
        {overdue > 0 && <span className="bar-fill overdue" style={{ width: width(overdue) }} />}
      </span>
      <span className="bar-value">
        {value}
        {overdue > 0 && <span className="late"> · {overdue} overdue</span>}
      </span>
    </BarRow>
  );
}

function BarRow({ href, title, children }: { href?: string; title: string; children: ReactNode }) {
  return href ? (
    <a className="bar-row link" href={href} title={`${title} · open on the board`}>
      {children}
    </a>
  ) : (
    <div className="bar-row" title={title}>
      {children}
    </div>
  );
}

function AttentionTasks({ title, list: { tasks, total }, showDue = false }: { title: string; list: AttentionList; showDue?: boolean }) {
  if (tasks.length === 0) return null;
  return (
    <div className="attention">
      <h3>{title}</h3>
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            <a href={boardLink({ task: t.id })}>{t.title}</a>
            <span className="muted small">
              {showDue && t.due_date && <span className="late">{dueLabel(t.due_date).text} · </span>}
              {t.assignee?.name ?? "Unassigned"}
            </span>
          </li>
        ))}
      </ul>
      {total > tasks.length && <p className="muted small">+{total - tasks.length} more</p>}
    </div>
  );
}

interface Column {
  key: string;
  /** Short label under the column; hidden from screen readers, which read `description`. */
  label: ReactNode;
  description: string;
  count: number;
  highlight?: boolean;
}

/** A row of small vertical bars: the days ahead, or the weeks behind. */
function ColumnStrip({ label, columns }: { label: string; columns: Column[] }) {
  const busiest = Math.max(1, ...columns.map((c) => c.count));
  return (
    <ol className="column-strip" aria-label={label}>
      {columns.map((c) => (
        <li key={c.key} className={c.highlight ? "highlight" : ""}>
          <span className="sr-only">{c.description}</span>
          <span className="column-count" aria-hidden="true">
            {c.count || ""}
          </span>
          <span className="column-bar" aria-hidden="true">
            {c.count > 0 && <span style={{ height: `${(c.count / busiest) * 100}%` }} />}
          </span>
          <span className="column-label" aria-hidden="true">
            {c.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

const upcomingColumns = (days: Stats["upcoming"]): Column[] =>
  days.map((d, i) => ({
    key: d.date,
    label: (
      <>
        {dayOf(d.date).toLocaleDateString(undefined, { weekday: "narrow" })}
        <br />
        {dayOf(d.date).getDate()}
      </>
    ),
    description: `${longDate(d.date)}: ${d.count} due`,
    count: d.count,
    highlight: i === 0,
  }));

const weeklyColumns = (weeks: Stats["completed"]): Column[] =>
  weeks.map((w, i) => ({
    key: w.week_start,
    label: i === weeks.length - 1 ? "This wk" : shortDate(w.week_start),
    description: `Week of ${longDate(w.week_start)}: ${w.count} finished`,
    count: w.count,
    highlight: i === weeks.length - 1,
  }));
