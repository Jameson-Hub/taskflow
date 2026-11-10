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

/** Wipes everything and restores the demo workspace. Runs nightly and in tests. */
export async function resetDemo(db: D1Database) {
  const day = (offset: number | null) =>
    offset === null ? null : new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

  await db.batch([
    db.prepare("DELETE FROM activity"),
    db.prepare("DELETE FROM comments"),
    db.prepare("DELETE FROM tasks"),
    db.prepare("DELETE FROM sessions"),
    db.prepare("DELETE FROM users"),
    ...TEAM.map((u, i) =>
      db
        .prepare("INSERT INTO users (id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 1)")
        .bind(i + 1, u.email, u.name, u.role),
    ),
    ...TASKS.map(({ title, status, priority, assignee, creator, dueInDays }, i) =>
      db
        .prepare(
          "INSERT INTO tasks (title, status, priority, position, assignee_id, created_by, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(title, status, priority, i + 1, assignee === null ? null : assignee + 1, creator + 1, day(dueInDays)),
    ),
  ]);
}
