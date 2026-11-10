import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { can } from "../shared/policy";
import { logActivity } from "./activity";
import { fail, idParam, orNotFound, readBody, type AppEnv } from "./http";

type CommentRow = { id: number; task_id: number; user_id: number; author_name: string; body: string; created_at: string };
type CommentsEnv = AppEnv & { Variables: { task: { id: number; title: string } } };

const toComment = ({ user_id, author_name, ...rest }: CommentRow) => ({ ...rest, author: { id: user_id, name: author_name } });

// Mounted at /tasks/:taskId/comments.
export const comments = new Hono<CommentsEnv>();

// The one place comments are tied to a workspace: a task outside the caller's reads as not found.
comments.use(
  "*",
  createMiddleware<CommentsEnv>(async (c, next) => {
    const task = await c.env.DB.prepare("SELECT id, title FROM tasks WHERE id = ? AND workspace_id = ?")
      .bind(idParam(c, "taskId"), c.var.user.workspace_id)
      .first<{ id: number; title: string }>();
    c.set("task", orNotFound(task, "Task"));
    await next();
  }),
);

comments.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.id",
  )
    .bind(c.var.task.id)
    .all<CommentRow>();
  return c.json(results.map(toComment));
});

comments.post("/", async (c) => {
  const { body } = await readBody(c, z.object({ body: z.string().trim().min(1).max(2000) }), "Write something first");
  const { task, user } = c.var;
  const [inserted] = await c.env.DB.batch<Omit<CommentRow, "author_name">>([
    c.env.DB.prepare("INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?) RETURNING *").bind(task.id, user.id, body),
    logActivity(c.env.DB, user, task.id, "comment.added", { title: task.title }),
  ]);
  return c.json(toComment({ ...inserted!.results[0]!, author_name: user.name }), 201);
});

comments.delete("/:commentId{[0-9]+}", async (c) => {
  const commentId = idParam(c, "commentId");
  const comment = orNotFound(
    await c.env.DB.prepare("SELECT user_id FROM comments WHERE id = ? AND task_id = ?").bind(commentId, c.var.task.id).first<{ user_id: number }>(),
    "Comment",
  );
  if (!can.deleteComment(c.var.user, comment.user_id)) fail(403, "You can only delete your own comments");
  await c.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(commentId).run();
  return c.body(null, 204);
});
