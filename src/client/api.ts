import type { Action, Priority, Role, Status } from "../shared/domain";
import { can as policy } from "../shared/policy";

export type { Priority, Role, Status };

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  demo: boolean;
  workspace: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  position: number;
  due_date: string | null;
  assignee: { id: number; name: string } | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: number;
  task_id: number;
  body: string;
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Sign-in routes answer 401 for a wrong password, not an expired session.
  if (res.status === 401 && !path.startsWith("/auth/")) onSessionExpired();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong");
  return data as T;
}

export const api = {
  me: () => request<User>("GET", "/me"),
  demoLogin: (role: Role) => request<User>("POST", "/auth/demo", { role }),
  login: (email: string, password: string, remember: boolean) => request<User>("POST", "/auth/login", { email, password, remember }),
  signup: (details: { name: string; email: string; password: string; workspace: string; website: string }) =>
    request<User>("POST", "/auth/signup", details),
  logout: () => request("POST", "/auth/logout"),
  changePassword: (current: string, next: string) => request("POST", "/me/password", { current, next }),
  deleteAccount: (password: string, deleteWorkspace: boolean) => request("DELETE", "/me", { password, deleteWorkspace }),

  users: () => request<User[]>("GET", "/users"),
  createUser: (user: Pick<User, "name" | "email" | "role"> & { password: string }) => request<User>("POST", "/users", user),
  setRole: (id: number, role: Role) => request<User>("PATCH", `/users/${id}`, { role }),

  tasks: (filters: Record<string, string>) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== "")).toString();
    return request<Task[]>("GET", `/tasks${query ? `?${query}` : ""}`);
  },
  createTask: (task: Partial<Task> & { assignee_id?: number | null }) => request<Task>("POST", "/tasks", task),
  updateTask: (id: number, changes: Partial<Omit<Task, "assignee">> & { assignee_id?: number | null }) =>
    request<Task>("PATCH", `/tasks/${id}`, changes),
  deleteTask: (id: number) => request<void>("DELETE", `/tasks/${id}`),

  comments: (taskId: number) => request<Comment[]>("GET", `/tasks/${taskId}/comments`),
  addComment: (taskId: number, body: string) => request<Comment>("POST", `/tasks/${taskId}/comments`, { body }),
  deleteComment: (taskId: number, id: number) => request<void>("DELETE", `/tasks/${taskId}/comments/${id}`),

  activity: () => request<ActivityEntry[]>("GET", "/activity"),
};

// The shared policy, adapted to the API's response shapes.
export const can = {
  ...policy,
  editTask: (u: User, t: Task) => policy.editTask(u, { created_by: t.created_by, assignee_id: t.assignee?.id ?? null }),
  deleteComment: (u: User, c: Comment) => policy.deleteComment(u, c.author.id),
};

export const STATUS_LABEL: Record<Status, string> = { todo: "To do", in_progress: "In progress", done: "Done" };
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", manager: "Manager", member: "Member" };
