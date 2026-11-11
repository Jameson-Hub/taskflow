import { DAY_MS, type Priority, type Status } from "../shared/domain";

const TEAM = [
  { email: "admin@taskflow.demo", name: "Alex Rivera", role: "admin" },
  { email: "manager@taskflow.demo", name: "Morgan Lee", role: "manager" },
  { email: "member@taskflow.demo", name: "Sam Cruz", role: "member" },
  { email: "jordan@taskflow.demo", name: "Jordan Tan", role: "member" },
] as const;

type SeedTask = { title: string; status: Status; priority: Priority; assignee: number | null; creator: number; dueInDays: number | null };

// assignee and creator are indexes into TEAM.
const TASKS: SeedTask[] = [
  { title: "Set up CI pipeline for the API", status: "done", priority: "high", assignee: 0, creator: 0, dueInDays: null },
  { title: "Design onboarding flow", status: "in_progress", priority: "high", assignee: 2, creator: 1, dueInDays: 3 },
  { title: "Write release notes for v1.2", status: "todo", priority: "medium", assignee: 3, creator: 1, dueInDays: 5 },
  { title: "Fix timezone bug on due dates", status: "in_progress", priority: "high", assignee: 3, creator: 1, dueInDays: 1 },
  { title: "Audit role permissions", status: "todo", priority: "high", assignee: 0, creator: 0, dueInDays: 7 },
  { title: "Update dependency versions", status: "todo", priority: "low", assignee: null, creator: 1, dueInDays: null },
  { title: "Add empty states to the board", status: "todo", priority: "medium", assignee: 2, creator: 2, dueInDays: 10 },
  { title: "Customer interview notes", status: "done", priority: "low", assignee: 2, creator: 1, dueInDays: null },
];

export const DEMO_WORKSPACE = 1;
const INACTIVE_DAYS = 30;

/** Rebuilds the demo workspace from scratch; real workspaces are untouched. Runs nightly and in tests. */
export async function resetDemo(db: D1Database) {
  const day = (offset: number | null) =>
    offset === null ? null : new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
  const userId = "(SELECT id FROM users WHERE email = ?)";

  await db.batch([
    // Cascades to the demo's people, sessions, tasks, comments and activity.
    db.prepare("DELETE FROM workspaces WHERE id = ?").bind(DEMO_WORKSPACE),
    db.prepare("INSERT INTO workspaces (id, name) VALUES (?, 'Demo workspace')").bind(DEMO_WORKSPACE),
    ...TEAM.map((u) =>
      db
        .prepare("INSERT INTO users (email, name, role, is_demo, workspace_id) VALUES (?, ?, ?, 1, ?)")
        .bind(u.email, u.name, u.role, DEMO_WORKSPACE),
    ),
    ...TASKS.map(({ title, status, priority, assignee, creator, dueInDays }, i) =>
      db
        .prepare(
          `INSERT INTO tasks (workspace_id, title, status, priority, position, assignee_id, created_by, due_date)
           VALUES (?, ?, ?, ?, ?, ${userId}, ${userId}, ?)`,
        )
        .bind(DEMO_WORKSPACE, title, status, priority, i + 1, assignee === null ? null : TEAM[assignee]!.email, TEAM[creator]!.email, day(dueInDays)),
    ),
  ]);
}

/** Deletes real workspaces nobody has used for 30 days, so abandoned and spam sign-ups clear themselves. */
export async function deleteInactiveWorkspaces(db: D1Database) {
  const cutoff = new Date(Date.now() - INACTIVE_DAYS * DAY_MS).toISOString();
  await db
    .prepare(
      `DELETE FROM workspaces WHERE id <> ? AND NOT EXISTS (
         SELECT 1 FROM users u WHERE u.workspace_id = workspaces.id AND u.deleted_at IS NULL AND datetime(COALESCE(u.last_seen_at, u.created_at)) > datetime(?))`,
    )
    .bind(DEMO_WORKSPACE, cutoff)
    .run();
}
