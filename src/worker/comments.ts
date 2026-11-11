import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { MAX_COMMENT, MAX_MENTIONS } from "../shared/domain";
import { can } from "../shared/policy";
import { logActivity } from "./activity";
import { fail, idParam, orNotFound, readBody, type AppEnv } from "./http";

/** `mentions` is a JSON array of user ids. */
type CommentRow = { id: number; task_id: number; user_id: number; author_name: string; body: string; mentions: string; created_at: string };
type CommentsEnv = AppEnv & { Variables: { task: { id: number; title: string } } };

const toComment = ({ user_id, author_name, mentions, ...rest }: CommentRow) => ({
  ...rest,
  mentions: JSON.parse(mentions) as number[],
  author: { id: user_id, name: author_name },
});

const newComment = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT),
  mentions: z.array(z.number().int()).max(MAX_MENTIONS).default([]),
});

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
  const { body, mentions } = await readBody(c, newComment, "Write something first");
  const { task, user } = c.var;
  const [inserted] = await c.env.DB.batch<Omit<CommentRow, "author_name">>([
    // Mentions keep only people on the caller's team, once each.
    c.env.DB.prepare(
      `INSERT INTO comments (task_id, user_id, body, mentions) VALUES (?1, ?2, ?3, (
         SELECT json_group_array(id) FROM (
           SELECT u.id FROM users u WHERE u.workspace_id = ?4 AND u.deleted_at IS NULL AND u.id IN (SELECT value FROM json_each(?5)) ORDER BY u.id))
       ) RETURNING *`,
    ).bind(task.id, user.id, body, user.workspace_id, JSON.stringify(mentions)),
    logActivity(c.env.DB, user, task.id, "comment.added", { title: task.title }),
    // A discussion is work on the task, so it no longer counts as untouched.
    c.env.DB.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").bind(task.id),
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
