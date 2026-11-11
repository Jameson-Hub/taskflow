import { useCallback, useEffect, useEffectEvent, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { api, can, PRIORITY_LABEL, STATUS_LABEL, type Status, type Task, type User } from "./api";
import { onBoardChange } from "./live";
import { byBoardOrder, columnOf, keyboardMove, placeAt, type Direction } from "../shared/moves";
import { TaskDrawer } from "./TaskDrawer";
import { STATUSES } from "../shared/domain";
import { checklistProgress, dueLabel, ErrorText, initials, LabelChip, Options, parseHash, useAction } from "./ui";

const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

export function Board({ user, team }: { user: User; team: User[] }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  // A dashboard link can arrive with filters set or a task to open; read it once, then tidy the address.
  const [linked] = useState(() => parseHash().params);
  const [filters, setFilters] = useState(() => ({
    q: "",
    assignee: linked.get("assignee") ?? "",
    priority: linked.get("priority") ?? "",
    label: linked.get("label") ?? "",
  }));
  useEffect(() => {
    if (location.hash.includes("?")) history.replaceState(null, "", "#board");
  }, []);
  const [labels, setLabels] = useState<string[]>([]);
  const [open, setOpen] = useState<Task | "new" | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: Status; index: number } | null>(null);
  const { error, setError, run } = useAction();

  // A linked task opens once, on the first load that has it; cleared so later reloads don't reopen it.
  const linkedTask = useRef(Number(linked.get("task")) || null);
  const load = useCallback(
    () =>
      run(async () => {
        const list = await api.tasks(filters);
        setTasks(list);
        const wanted = linkedTask.current;
        if (wanted === null) return;
        linkedTask.current = null;
        const task = list.find((t) => t.id === wanted);
        if (task) setOpen(task);
        else throw new Error("That task no longer exists");
      }),
    [filters, run],
  );
  // Filtering never changes which labels exist, so these load on open and after a save only.
  const loadLabels = useCallback(() => run(() => api.labels().then(setLabels)), [run]);

  useEffect(() => {
    loadLabels();
  }, [loadLabels]);

  // Live updates: when anyone in the workspace changes something, reload what this board shows. An effect
  // event reads the current filters without reconnecting the socket each time they change.
  const refresh = useEffectEvent(() => {
    load();
    loadLabels();
  });
  useEffect(() => onBoardChange(refresh), []);

  useEffect(() => {
    const timer = setTimeout(load, filters.q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.q]);

  const column = (status: Status) => columnOf(tasks, status);

  async function drop(e: DragEvent, status: Status) {
    e.preventDefault();
    const task = tasks.find((t) => t.id === dragging);
    const index = dropTarget?.index ?? column(status).length;
    setDragging(null);
    setDropTarget(null);
    if (!task) return;

    const { position } = placeAt(tasks, task, status, index);
    if (task.status === status && task.position === position) return;
    await move(task, status, position);
  }

  // Keyboard moves: Alt/Option + arrows on a focused card. Focus follows the card, and screen readers hear where it went.
  const [announcement, setAnnouncement] = useState("");
  // Once, right after the move re-renders the card (possibly in another column); later refreshes leave focus alone.
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    if (refocus.current === null) return;
    document.querySelector<HTMLElement>(`[data-task="${refocus.current}"] .card-body`)?.focus();
    refocus.current = null;
  }, [tasks]);

  async function moveWithKeys(e: KeyboardEvent<HTMLButtonElement>, task: Task, editable: boolean) {
    const direction = ARROWS[e.key];
    if (!e.altKey || !direction) return;
    // Always claimed, so Alt+Left/Right never falls through to the browser's Back/Forward.
    e.preventDefault();
    if (!editable) return setAnnouncement(`"${task.title}" is view only, so it can't be moved`);
    const target = keyboardMove(tasks, task, direction);
    if (!target) return;
    refocus.current = task.id;
    const moved = await move(task, target.status, target.position);
    setAnnouncement(
      moved ? `Moved "${task.title}" to ${STATUS_LABEL[target.status]}, position ${target.index + 1}` : `Couldn't move "${task.title}"`,
    );
  }

  // Board-wide shortcuts: N for a new task, / to search.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // Not while typing in a field or with a dialog open.
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      // e.code too, so N works on non-Latin layouts and with Caps Lock or Shift.
      if (e.key.toLowerCase() === "n" || e.code === "KeyN") {
        e.preventDefault();
        setOpen("new");
      } else if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  /** Moves a card optimistically, rolling back if the server says no. Resolves to whether it stuck. */
  async function move(task: Task, status: Status, position: number) {
    const previous = tasks;
    setTasks((all) => all.map((t) => (t.id === task.id ? { ...t, status, position } : t)).sort(byBoardOrder));
    let moved = true;
    await run(() =>
      api.updateTask(task.id, { status, position }).catch((err) => {
        moved = false;
        refocus.current = task.id; // the rollback may remount the card in its old column
        setTasks(previous);
        throw err;
      }),
    );
    return moved;
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
          ref={search}
          type="search"
          placeholder="Search tasks…  ( / )"
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
        <button className="primary" onClick={() => setOpen("new")} aria-keyshortcuts="N" title="New task (N)">
          + New task
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <p id="move-hint" className="sr-only">
        Press Alt or Option with the arrow keys to move this card.
      </p>

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
                      data-task={task.id}
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
                      <button
                        className="card-body"
                        onClick={() => setOpen(task)}
                        onKeyDown={(e) => moveWithKeys(e, task, editable)}
                        aria-describedby={editable ? "move-hint" : undefined}
                        data-movable={editable || undefined}
                      >
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
                          {task.checklist.length > 0 && (
                            <span className="muted" title="Checklist">
                              ☑ {checklistProgress(task.checklist)}
                            </span>
                          )}
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
