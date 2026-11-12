import { useCallback, useEffect, useEffectEvent, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { api, can, PRIORITY_LABEL, STATUS_LABEL, type Status, type Task, type User } from "./api";
import { onBoardChange } from "./live";
import { beforeSignOut } from "./signOut";
import { byBoardOrder, columnOf, keyboardMove, placeAt, type Direction } from "../shared/moves";
import { TaskDrawer } from "./TaskDrawer";
import { STATUSES } from "../shared/domain";
import { downloadCsv } from "./csv";
import { CardFace, ErrorText, Options, parseHash, useAction } from "./ui";

const UNDO_MS = 10_000;
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
    mentioned: "",
  }));
  useEffect(() => {
    if (location.hash.includes("?")) history.replaceState(null, "", "#board");
  }, []);
  const [labels, setLabels] = useState<string[]>([]);
  const [open, setOpen] = useState<Task | "new" | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: Status; index: number } | null>(null);
  const { error, setError, run } = useAction();
  // Deleting waits UNDO_MS before reaching the server, so it can be undone with comments and history intact.
  const pendingDelete = useRef<{ task: Task; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [undoTask, setUndoTask] = useState<Task | null>(null);
  // An open task deleted by someone else: the drawer says so instead of failing on save.
  const [goneId, setGoneId] = useState<number | null>(null);

  // A linked task opens once, on the first load that has it; cleared so later reloads don't reopen it.
  const linkedTask = useRef(Number(linked.get("task")) || null);
  const load = useCallback(
    () =>
      run(async () => {
        // A task waiting out its undo window is gone as far as this board is concerned.
        const list = (await api.tasks(filters)).filter((t) => t.id !== pendingDelete.current?.task.id);
        setTasks(list);
        // An open task follows the reload, so the drawer sees others' changes (followOpenTask covers it leaving the list).
        setOpen((o) => (o && o !== "new" ? (list.find((t) => t.id === o.id) ?? o) : o));
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

  /** Ends the undo window and hands back the task that was waiting, if any. */
  function takePending() {
    const pending = pendingDelete.current;
    if (!pending) return null;
    clearTimeout(pending.timer);
    pendingDelete.current = null;
    setUndoTask(null);
    return pending;
  }

  // The undo timer outlives renders, so it reloads through this to use the current filters.
  const latestLoad = useRef(load);
  useEffect(() => {
    latestLoad.current = load;
  }, [load]);

  function commitDelete(keepalive = false) {
    const pending = takePending();
    if (!pending) return Promise.resolve();
    return run(() =>
      api.deleteTask(pending.task.id, { keepalive }).catch((err) => {
        latestLoad.current(); // put it back if the server refused
        throw err;
      }),
    );
  }

  function deleteWithUndo(task: Task) {
    commitDelete(); // one undo at a time: an earlier pending delete goes through now
    setOpen(null);
    setTasks((all) => all.filter((t) => t.id !== task.id));
    pendingDelete.current = { task, timer: setTimeout(() => commitDelete(), UNDO_MS) };
    setUndoTask(task);
  }

  function undoDelete() {
    // A fresh load rather than the old copy: someone may have edited it, or the filters changed, meanwhile.
    if (takePending()) latestLoad.current();
  }

  // Leaving the board or closing the tab doesn't cancel a delete: it's sent straight away.
  const flushDelete = useEffectEvent(() => commitDelete(true));
  useEffect(() => {
    const flush = () => flushDelete();
    addEventListener("pagehide", flush);
    const unregister = beforeSignOut(flush); // signing out ends the session the delete needs
    return () => {
      removeEventListener("pagehide", flush);
      unregister();
      flush();
    };
  }, []);

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

  // The open task left the list: filtered out by a teammate's change, or deleted. Fetch it on its own to tell.
  const followOpenTask = useEffectEvent(() => {
    if (!open || open === "new" || tasks.some((t) => t.id === open.id) || goneId === open.id) return;
    const id = open.id;
    api.task(id).then(
      (latest) => setOpen((o) => (o !== "new" && o?.id === id ? latest : o)),
      (err: { status?: number }) => err.status === 404 && setGoneId(id),
    );
  });
  useEffect(() => followOpenTask(), [tasks]);

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
        <label className="check">
          <input
            type="checkbox"
            checked={filters.mentioned === "1"}
            onChange={(e) => setFilters({ ...filters, mentioned: e.target.checked ? "1" : "" })}
          />{" "}
          Mentions me
        </label>
        <button onClick={() => downloadCsv(tasks)} disabled={tasks.length === 0} title="Download the tasks shown as a spreadsheet">
          Export CSV
        </button>
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
                        <CardFace task={task}>
                          {!editable && (
                            <span className="lock" title="You can view this task but not edit it">
                              view only
                            </span>
                          )}
                        </CardFace>
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
          onDelete={deleteWithUndo}
          gone={open !== "new" && open.id === goneId}
        />
      )}

      {/* Always in the page, so screen readers announce the message when it appears. */}
      <div className={undoTask ? "toast" : "sr-only"} role="status">
        {undoTask && (
          <>
            Deleted "{undoTask.title}".
            <button className="ghost" onClick={undoDelete}>
              Undo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
