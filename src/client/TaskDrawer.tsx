import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, can, PRIORITY_LABEL, STATUS_LABEL, type Comment, type Priority, type Status, type Task, type User } from "./api";
import { CommentBox, CommentText } from "./mentions";
import { Checklist, ErrorText, formatTimestamp, initials, LabelInput, Options, useAction } from "./ui";

interface Props {
  task: Task | null;
  user: User;
  team: User[];
  labels: string[];
  onClose: () => void;
  onChanged: () => void;
  /** The board removes it, with a few seconds to undo. */
  onDelete: (task: Task) => void;
  /** Deleted by someone else while open. */
  gone?: boolean;
}

type Field = keyof ReturnType<typeof fields>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const FIELD_LABEL: Record<Field, string> = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  due_date: "due date",
  assignee_id: "assignee",
  labels: "labels",
  checklist: "checklist",
};

/** The editable fields of a task, as the form holds them. */
function fields(task: Task | null, defaultAssignee: number | null) {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? ("todo" as Status),
    priority: task?.priority ?? ("medium" as Priority),
    due_date: task?.due_date ?? "",
    assignee_id: task?.assignee?.id ?? defaultAssignee,
    labels: task?.labels ?? [],
    checklist: task?.checklist ?? [],
  };
}

export function TaskDrawer({ task, user, team, labels, onClose, onChanged, onDelete, gone = false }: Props) {
  const creating = task === null;
  // Decided when it opens: a teammate reassigning it mid-edit mustn't silently drop what you typed (the server still checks on save).
  const [canEdit] = useState(() => creating || can.editTask(user, task));
  const editable = canEdit && !gone;
  const [initial, setInitial] = useState(() => fields(task, creating && user.role === "member" ? user.id : null));
  const [draft, setDraft] = useState(initial);
  // Fields you and a teammate both changed since it loaded: yours are kept until you load theirs or save.
  const [clashes, setClashes] = useState<Field[]>([]);
  // Closing (✕, Esc or the backdrop) asks before throwing away unsaved edits.
  const dirty = editable && !same(draft, initial);
  const keepEditing = () => dirty && !confirm("Discard your unsaved changes?");
  const close = () => {
    if (!keepEditing()) onClose();
  };
  // A teammate's save arrives through the board's live reload as a newer `task`. Fields you haven't touched take
  // their value; fields you both changed keep yours. Compared by value, not updated_at (whole seconds only, and
  // comments touch it too). Adjusting state while rendering, as React suggests; it settles once `initial` matches.
  const theirs = task && fields(task, null);
  if (theirs && JSON.stringify(theirs) !== JSON.stringify(initial)) {
    const keys = Object.keys(theirs) as Field[];
    const mine = keys.filter((k) => !same(draft[k], initial[k]));
    setClashes([...new Set([...clashes, ...mine.filter((k) => !same(theirs[k], initial[k]) && !same(theirs[k], draft[k]))])]);
    setDraft({ ...theirs, ...Object.fromEntries(mine.map((k) => [k, draft[k]])) });
    setInitial(theirs);
  }
  // A clash goes away once your value matches theirs again.
  const shownClashes = clashes.filter((k) => !same(draft[k], initial[k]));
  const loadTheirs = () => {
    setDraft({ ...draft, ...Object.fromEntries(clashes.map((k) => [k, initial[k]])) });
    setClashes([]);
  };
  const [comments, setComments] = useState<Comment[]>([]);
  const { error, run } = useAction();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // Each live reload hands over a fresh `task`, so comments reload with it.
  useEffect(() => {
    if (task) api.comments(task.id).then(setComments, () => {}); // a missed refresh is fixed by the next one
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
        // Only what you changed since it was loaded, so a teammate's edit to another field isn't undone.
        const changes = Object.fromEntries(
          Object.entries(payload).filter(([key]) => !same(draft[key as Field], initial[key as Field])),
        );
        if (Object.keys(changes).length > 0) await api.updateTask(task.id, changes);
      }
      onChanged();
      onClose();
    });
  }

  /** Resolves to whether it was saved, so the box keeps the text when it wasn't. */
  async function addComment(body: string, mentions: number[]) {
    let saved = false;
    await run(async () => {
      const created = await api.addComment(task!.id, body, mentions);
      setComments((all) => [...all, created]);
      saved = true;
    });
    return saved;
  }

  const removeComment = (c: Comment) =>
    run(async () => {
      await api.deleteComment(c.task_id, c.id);
      setComments((all) => all.filter((x) => x.id !== c.id));
    });

  return (
    <dialog
      ref={dialog}
      className="drawer"
      onCancel={(e) => keepEditing() && e.preventDefault()}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && close()}
    >
      <form className="drawer-body" onSubmit={save}>
        <header>
          <h2>{creating ? "New task" : editable ? "Edit task" : "Task"}</h2>
          <button type="button" className="ghost" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>

        {/* Always in the page, so screen readers announce what appears in it. */}
        <div role="status">
          {gone ? (
            <p className="notice drawer-notice">Someone else deleted this task.</p>
          ) : (
            shownClashes.length > 0 && (
              <p className="notice drawer-notice">
                Someone else also changed the {shownClashes.map((k) => FIELD_LABEL[k]).join(", ")}. Yours is kept; saving replaces theirs.{" "}
                <button type="button" className="ghost" onClick={loadTheirs}>
                  Load theirs
                </button>
              </p>
            )
          )}
        </div>
        {!canEdit && <p className="muted small">You can comment, but only the assignee, creator or a manager can edit this task.</p>}

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
          {/* htmlFor points at the text box; otherwise a click on the caption would press the first chip's remove button. */}
          <label htmlFor="label-input">
            Labels
            <LabelInput value={draft.labels} known={labels} onChange={(next) => setDraft({ ...draft, labels: next })} />
          </label>
          <Checklist items={draft.checklist} onChange={(next) => setDraft({ ...draft, checklist: next })} />
        </fieldset>

        <ErrorText error={error} />

        <div className="actions">
          {!creating && !gone && can.deleteTask(user) && (
            <button type="button" className="danger" onClick={() => onDelete(task!)}>
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
                  <CommentText body={c.body} mentions={c.mentions} team={team} />
                </div>
                {can.deleteComment(user, c) && (
                  <button className="ghost small" aria-label="Delete comment" onClick={() => removeComment(c)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
          <CommentBox team={team} onSend={addComment} />
        </section>
      )}
    </dialog>
  );
}
