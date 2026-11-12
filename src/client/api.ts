import type { Action, Priority, Role, SharedTask, Stats, Status, Task, WeeklySummary } from "../shared/domain";
import { can as policy } from "../shared/policy";

export type { Priority, Role, SharedTask, Status, Task };

export interface Invite {
  workspace: string;
  role: Role;
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  demo: boolean;
  demo_workspace: boolean;
  workspace: string;
}

export type ShareStatus = { enabled: true; created_at: string } | { enabled: false };

export interface Comment {
  id: number;
  task_id: number;
  body: string;
  mentions: number[];
  author: { id: number; name: string };
  created_at: string;
}

export interface ActivityEntry {
  id: number;
  action: Action;
  actor: { id: number; name: string };
  task_id: number | null;
  detail: { title: string; changes?: Record<string, [unknown, unknown]> };
  created_at: string;
}

let onSessionExpired = () => {};

/** Called when a signed-in request comes back 401, e.g. a session that ran out while the tab was open. */
export function whenSessionExpires(handler: () => void) {
  onSessionExpired = handler;
}

async function request<T>(method: string, path: string, body?: unknown, { keepalive = false } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    keepalive,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Sign-in routes answer 401 for a wrong password, not an expired session.
  if (res.status === 401 && !path.startsWith("/auth/")) onSessionExpired();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  // The status rides along for callers that treat some failures differently, e.g. a 404.
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? "Something went wrong"), { status: res.status });
  return data as T;
}

export const api = {
  me: () => request<User>("GET", "/me"),
  demoLogin: (role: Role) => request<User>("POST", "/auth/demo", { role }),
  login: (email: string, password: string, remember: boolean) => request<User>("POST", "/auth/login", { email, password, remember }),
  signup: (details: { name: string; email: string; password: string; workspace: string; website: string }) =>
    request<User>("POST", "/auth/signup", details),
  logout: () => request("POST", "/auth/logout"),
  invite: (token: string) => request<Invite>("POST", "/auth/invite", { token }),
  join: (details: { token: string; name: string; email: string; password: string }) => request<User>("POST", "/auth/join", details),
  createInvite: (role: Role) => request<{ token: string; expires_at: string }>("POST", "/invites", { role }),
  sharedBoard: (token: string) => request<{ workspace: string; tasks: SharedTask[] }>("POST", "/shared", { token }),
  shareStatus: () => request<ShareStatus>("GET", "/share"),
  createShare: () => request<{ token: string }>("POST", "/share"),
  stopShare: () => request("DELETE", "/share"),
  changePassword: (current: string, next: string) => request("POST", "/me/password", { current, next }),
  deleteAccount: (password: string, deleteWorkspace: boolean) => request("DELETE", "/me", { password, deleteWorkspace }),

  users: () => request<User[]>("GET", "/users"),
  createUser: (user: Pick<User, "name" | "email" | "role"> & { password: string }) => request<User>("POST", "/users", user),
  setRole: (id: number, role: Role) => request<User>("PATCH", `/users/${id}`, { role }),

  tasks: (filters: Record<string, string>) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== "")).toString();
    return request<Task[]>("GET", `/tasks${query ? `?${query}` : ""}`);
  },
  task: (id: number) => request<Task>("GET", `/tasks/${id}`),
  labels: () => request<string[]>("GET", "/tasks/labels"),
  stats: (today: string, mine: boolean) => request<Stats>("GET", `/stats?today=${today}${mine ? "&mine=1" : ""}`),
  createTask: (task: Partial<Task> & { assignee_id?: number | null }) => request<Task>("POST", "/tasks", task),
  updateTask: (id: number, changes: Partial<Omit<Task, "assignee">> & { assignee_id?: number | null }) =>
    request<Task>("PATCH", `/tasks/${id}`, changes),
  /** `keepalive` lets the request finish while the page is closing. */
  deleteTask: (id: number, { keepalive = false } = {}) => request<void>("DELETE", `/tasks/${id}`, undefined, { keepalive }),

  comments: (taskId: number) => request<Comment[]>("GET", `/tasks/${taskId}/comments`),
  addComment: (taskId: number, body: string, mentions: number[]) => request<Comment>("POST", `/tasks/${taskId}/comments`, { body, mentions }),
  deleteComment: (taskId: number, id: number) => request<void>("DELETE", `/tasks/${taskId}/comments/${id}`),

  activity: () => request<ActivityEntry[]>("GET", "/activity"),
  weekly: () => request<WeeklySummary[]>("GET", "/activity/weekly"),
};

// The shared policy, adapted to the API's response shapes.
export const can = {
  ...policy,
  editTask: (u: User, t: Task) => policy.editTask(u, { created_by: t.created_by, assignee_id: t.assignee?.id ?? null }),
  deleteComment: (u: User, c: Comment) => policy.deleteComment(u, c.author.id),
};

export { PRIORITY_LABEL, ROLE_LABEL, STATUS_LABEL } from "../shared/domain";
