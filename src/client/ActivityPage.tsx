import { useEffect, useState } from "react";
import { api, ROLE_LABEL, STATUS_LABEL, type ActivityEntry, type Role, type Status, type User } from "./api";
import { checklistProgress, type ChecklistItem, type WeeklySummary } from "../shared/domain";
import { formatTimestamp, shortDate } from "./ui";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const FIELD_LABEL: Record<string, string> = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  due_date: "due date",
  assignee_id: "assignee",
};

function describe(entry: ActivityEntry, names: Map<number, string>) {
  const title = `“${entry.detail.title}”`;
  switch (entry.action) {
    case "task.created":
      return `created ${title}`;
    case "task.deleted":
      return `deleted ${title}`;
    case "comment.added":
      return `commented on ${title}`;
    case "user.left":
      return "deleted their account";
    case "user.role_changed": {
      const [from, to] = entry.detail.changes?.role ?? [];
      return `changed ${entry.detail.title}'s role from ${ROLE_LABEL[from as Role]} to ${ROLE_LABEL[to as Role]}`;
    }
    case "task.updated": {
      const parts = Object.entries(entry.detail.changes ?? {}).map(([field, [, to]]) => {
        if (field === "status") return `moved it to ${STATUS_LABEL[to as Status]}`;
        if (field === "assignee_id") return to === null ? "unassigned it" : `assigned it to ${names.get(to as number) ?? "someone"}`;
        if (field === "priority") return `set priority to ${to}`;
        if (field === "checklist") return `updated the checklist (${checklistProgress(to as ChecklistItem[])} done)`;
        if (field === "labels") return (to as string[]).length ? `set labels to ${(to as string[]).join(", ")}` : "removed its labels";
        return `changed the ${FIELD_LABEL[field] ?? field}`;
      });
      return `updated ${title}: ${parts.join(", ")}`;
    }
  }
}

export function ActivityPage({ team }: { team: User[] }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [weeks, setWeeks] = useState<WeeklySummary[]>([]);
  const names = new Map(team.map((u) => [u.id, u.name]));

  useEffect(() => {
    api.activity().then(setEntries);
    api.weekly().then(setWeeks, () => {}); // a missing summary isn't worth an error on this page
  }, []);

  return (
    <section className="page">
      <h1>Activity</h1>
      <p className="muted">The last 100 changes to the board and the team. Visible to managers and admins.</p>
      <h2>Weekly summaries</h2>
      {weeks.length === 0 ? (
        <p className="muted small">The first one arrives on Monday at 00:00 UTC, once there's been a week of work.</p>
      ) : (
        <ul className="weekly">
          {weeks.map((w) => (
            <li key={w.week_end}>
              <strong>Week of {shortDate(w.week_start)}:</strong> {plural(w.created, "task")} added, {w.finished} finished,{" "}
              {plural(w.comments, "comment")}.{w.busiest && ` Busiest: ${w.busiest.name} (${plural(w.busiest.changes, "change")}).`}
            </li>
          ))}
        </ul>
      )}
      <h2>Latest changes</h2>
      {entries?.length === 0 && <p className="empty">No activity since the last reset. Make a change on the board.</p>}
      <ol className="feed">
        {entries?.map((e) => (
          <li key={e.id}>
            <strong>{e.actor.name}</strong> {describe(e, names)}
            <time className="muted small" dateTime={e.created_at}>
              {formatTimestamp(e.created_at)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}
