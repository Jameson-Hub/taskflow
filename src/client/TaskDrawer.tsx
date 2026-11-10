import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, can, PRIORITY_LABEL, STATUS_LABEL, type Comment, type Priority, type Status, type Task, type User } from "./api";
import { ErrorText, formatTimestamp, initials, Options, useAction } from "./ui";

interface Props {
  task: Task | null;
  user: User;
  team: User[];
  onClose: () => void;
  onChanged: () => void;
}

export function TaskDrawer({ task, user, team, onClose, onChanged }: Props) {
  const creating = task === null;
  const editable = creating || can.editTask(user, task);
  const [draft, setDraft] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? ("todo" as Status),
    priority: task?.priority ?? ("medium" as Priority),
    due_date: task?.due_date ?? "",
    assignee_id: task?.assignee?.id ?? (creating && user.role === "member" ? user.id : null),
  });
  const [comments, setComments] = useState<Comment[]>([]);
  const { error, run } = useAction();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
    if (task) api.comments(task.id).then(setComments);
  }, [task]);

  // Members may only pick themselves; leads can pick anyone.
  const assignable = can.reassign(user) ? team : team.filter((m) => m.id === user.id);

  function save(e: FormEvent) {
    e.preventDefault();
    const payload = { ...draft, due_date: draft.due_date || null };
    run(async () => {
      if (creating) {
        await api.createTask(payload);
      } else {
        const changes = Object.fromEntries(
          Object.entries(payload).filter(([key, value]) =>
            key === "assignee_id" ? value !== (task.assignee?.id ?? null) : value !== task[key as keyof Task],
          ),
        );
        if (Object.keys(changes).length > 0) await api.updateTask(task.id, changes);
      }
      onChanged();
      onClose();
    });
  }

  const remove = () =>
    run(async () => {
      await api.deleteTask(task!.id);
      onChanged();
      onClose();
    });

  function addComment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body"));
    run(async () => {
      const created = await api.addComment(task!.id, body);
      setComments((all) => [...all, created]);
      form.reset();
    });
  }

  const removeComment = (c: Comment) =>
    run(async () => {
      await api.deleteComment(c.task_id, c.id);
      setComments((all) => all.filter((x) => x.id !== c.id));
    });

  return (
    <dialog ref={dialog} className="drawer" onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}>
      <form className="drawer-body" onSubmit={save}>
        <header>
          <h2>{creating ? "New task" : editable ? "Edit task" : "Task"}</h2>
          <button type="button" className="ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {!editable && <p className="muted small">You can comment, but only the assignee, creator or a manager can edit this task.</p>}

        <fieldset disabled={!editable}>
          <label>
            Title
            <input required maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label>
            Description
            <textarea rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <div className="row">
            <label>
              Status
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}>
                <Options labels={STATUS_LABEL} />
              </select>
            </label>
            <label>
              Priority
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>
                <Options labels={PRIORITY_LABEL} />
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              Due date
              <input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} />
            </label>
            <label>
              Assignee
              <select
                value={draft.assignee_id ?? ""}
                onChange={(e) => setDraft({ ...draft, assignee_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Unassigned</option>
                {assignable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                {draft.assignee_id !== null && !assignable.some((m) => m.id === draft.assignee_id) && (
                  <option value={draft.assignee_id}>{task?.assignee?.name}</option>
                )}
              </select>
            </label>
          </div>
        </fieldset>

        <ErrorText error={error} />

        <div className="actions">
          {!creating && can.deleteTask(user) && (
            <button type="button" className="danger" onClick={remove}>
              Delete
            </button>
          )}
          {editable && <button className="primary">{creating ? "Create task" : "Save changes"}</button>}
        </div>
      </form>

      {task && (
        <section className="comments" aria-label="Comments">
          <h3>Comments</h3>
          {comments.length === 0 && <p className="muted small">No comments yet.</p>}
          <ul>
            {comments.map((c) => (
              <li key={c.id}>
                <span className="avatar">{initials(c.author.name)}</span>
                <div>
                  <p className="small">
                    <strong>{c.author.name}</strong>{" "}
                    <time className="muted" dateTime={c.created_at}>
                      {formatTimestamp(c.created_at)}
                    </time>
                  </p>
                  <p>{c.body}</p>
                </div>
                {can.deleteComment(user, c) && (
                  <button className="ghost small" aria-label="Delete comment" onClick={() => removeComment(c)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form className="comment-form" onSubmit={addComment}>
            <input name="body" placeholder="Write a comment…" aria-label="Write a comment" required maxLength={2000} />
            <button className="primary">Send</button>
          </form>
        </section>
      )}
    </dialog>
  );
}
