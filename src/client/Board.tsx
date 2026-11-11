import { useCallback, useEffect, useState, type DragEvent } from "react";
import { api, can, PRIORITY_LABEL, STATUS_LABEL, type Status, type Task, type User } from "./api";
import { TaskDrawer } from "./TaskDrawer";
import { DAY_MS, STATUSES } from "../shared/domain";
import { ErrorText, initials, LabelChip, localToday, Options, useAction } from "./ui";

/** Cards say "Due in Nd" instead of the date this close to the deadline. */
const CARD_SOON_DAYS = 2;

/** Position that slots a card between its new neighbours without renumbering the column. */
function positionBetween(before?: Task, after?: Task) {
  if (before && after) return (before.position + after.position) / 2;
  if (before) return before.position + 1;
  if (after) return after.position - 1;
  return 1;
}

// Due dates are calendar days, so compare against the viewer's local date, not UTC's.
function dueLabel(date: string) {
  const days = Math.round((Date.parse(date) - Date.parse(localToday())) / DAY_MS);
  if (days < 0) return { text: `${-days}d overdue`, tone: "late" };
  if (days === 0) return { text: "Due today", tone: "soon" };
  if (days <= CARD_SOON_DAYS) return { text: `Due in ${days}d`, tone: "soon" };
  return { text: new Date(date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }), tone: "" };
}

export function Board({ user, team }: { user: User; team: User[] }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filters, setFilters] = useState({ q: "", assignee: "", priority: "", label: "" });
  const [labels, setLabels] = useState<string[]>([]);
  const [open, setOpen] = useState<Task | "new" | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: Status; index: number } | null>(null);
  const { error, setError, run } = useAction();

  const load = useCallback(() => run(() => api.tasks(filters).then(setTasks)), [filters, run]);
  // Filtering never changes which labels exist, so these load on open and after a save only.
  const loadLabels = useCallback(() => run(() => api.labels().then(setLabels)), [run]);

  useEffect(() => {
    loadLabels();
  }, [loadLabels]);

  useEffect(() => {
    const timer = setTimeout(load, filters.q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.q]);

  const column = (status: Status) => tasks.filter((t) => t.status === status);

  async function drop(e: DragEvent, status: Status) {
    e.preventDefault();
    const task = tasks.find((t) => t.id === dragging);
    const index = dropTarget?.index ?? column(status).length;
    setDragging(null);
    setDropTarget(null);
    if (!task) return;

    const others = column(status).filter((t) => t.id !== task.id);
    const position = positionBetween(others[index - 1], others[index]);
    if (task.status === status && task.position === position) return;

    // Optimistic: move the card now, roll back if the server says no.
    const previous = tasks;
    setTasks((all) =>
      all.map((t) => (t.id === task.id ? { ...t, status, position } : t)).sort((a, b) => a.position - b.position || a.id - b.id),
    );
    await run(() =>
      api.updateTask(task.id, { status, position }).catch((err) => {
        setTasks(previous);
        throw err;
      }),
    );
  }

  function overCard(e: DragEvent, status: Status, index: number) {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const target = index + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
    // dragover fires continuously; only re-render when the slot actually changes.
    setDropTarget((prev) => (prev?.status === status && prev.index === target ? prev : { status, index: target }));
  }

  return (
    <div className="board-page">
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search tasks…"
          aria-label="Search tasks"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <select aria-label="Assignee" value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}>
          <option value="">Anyone</option>
          <option value={String(user.id)}>Me</option>
          <option value="none">Unassigned</option>
          {team
            .filter((m) => m.id !== user.id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
        <select aria-label="Priority" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
          <option value="">Any priority</option>
          <Options labels={PRIORITY_LABEL} />
        </select>
        {(labels.length > 0 || filters.label) && (
          <select aria-label="Label" value={filters.label} onChange={(e) => setFilters({ ...filters, label: e.target.value })}>
            <option value="">Any label</option>
            {/* Keep the chosen label selectable even after its last task drops it, so the filter can be cleared. */}
            <Options labels={Object.fromEntries([...labels, ...(filters.label ? [filters.label] : [])].map((l) => [l, l]))} />
          </select>
        )}
        <button className="primary" onClick={() => setOpen("new")}>
          + New task
        </button>
      </div>

      <ErrorText error={error} onDismiss={() => setError("")} />

      <div className="board">
        {STATUSES.map((status) => {
          const cards = column(status);
          return (
            <section
              key={status}
              className={`column ${dropTarget?.status === status ? "is-over" : ""}`}
              aria-label={STATUS_LABEL[status]}
              onDragOver={(e) => {
                e.preventDefault();
                if (dropTarget?.status !== status) setDropTarget({ status, index: cards.length });
              }}
              onDrop={(e) => drop(e, status)}
            >
              <h2>
                {STATUS_LABEL[status]} <span className="count">{cards.length}</span>
              </h2>
              <ul>
                {cards.map((task, index) => {
                  const editable = can.editTask(user, task);
                  const due = task.due_date && task.status !== "done" ? dueLabel(task.due_date) : null;
                  return (
                    <li
                      key={task.id}
                      className={[
                        "card",
                        dragging === task.id && "is-dragging",
                        dropTarget?.status === status && dropTarget.index === index && "drop-before",
                        dropTarget?.status === status && dropTarget.index === index + 1 && index === cards.length - 1 && "drop-after",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      draggable={editable}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(task.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(e) => overCard(e, status, index)}
                    >
                      <button className="card-body" onClick={() => setOpen(task)}>
                        <span className="card-title">{task.title}</span>
                        {task.labels.length > 0 && (
                          <span className="card-labels">
                            {task.labels.map((l) => (
                              <LabelChip key={l} name={l} />
                            ))}
                          </span>
                        )}
                        <span className="card-meta">
                          <span className={`priority priority-${task.priority}`}>{task.priority}</span>
                          {due && <span className={`due ${due.tone}`}>{due.text}</span>}
                          {!editable && (
                            <span className="lock" title="You can view this task but not edit it">
                              view only
                            </span>
                          )}
                          <span className="avatar" title={task.assignee?.name ?? "Unassigned"}>
                            {task.assignee ? initials(task.assignee.name) : "–"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {cards.length === 0 && (
                <p className="empty">{tasks.length === 0 && status === "todo" ? "Your board is empty. Add your first task." : "Nothing here yet"}</p>
              )}
            </section>
          );
        })}
      </div>

      {open && (
        <TaskDrawer
          key={open === "new" ? "new" : open.id}
          task={open === "new" ? null : open}
          user={user}
          team={team}
          labels={labels}
          onClose={() => setOpen(null)}
          onChanged={() => {
            load();
            loadLabels();
          }}
        />
      )}
    </div>
  );
}
