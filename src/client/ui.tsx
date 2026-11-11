import { useCallback, useState, type CSSProperties, type KeyboardEvent } from "react";
import { DAY_MS, isoDate, MAX_LABEL_LENGTH, MAX_LABELS, normalizeLabel } from "../shared/domain";

/** Runs an async action, keeping its error message for display. */
export function useAction() {
  const [error, setError] = useState("");
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  return { error, setError, run };
}

export function ErrorText({ error, onDismiss }: { error: string; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <p className="error" role="alert" onClick={onDismiss}>
      {error}
    </p>
  );
}

export function Options({ labels }: { labels: Record<string, string> }) {
  return Object.entries(labels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** The app's routes live in the hash: `#page?key=value`, e.g. `#board?assignee=4&label=bug` or `#board?task=12`. */
export function parseHash() {
  const [page = "", query = ""] = location.hash.slice(1).split("?");
  return { page, params: new URLSearchParams(query) };
}

export const boardLink = (params: Record<string, string | number>) =>
  `#board?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;

/** Today on the viewer's own calendar; due dates and "overdue" are measured against this. */
export const localToday = () => isoDate(Date.now() - new Date().getTimezoneOffset() * 60_000);

/** Due labels say "Due in Nd" instead of the date this close to the deadline. */
const CARD_SOON_DAYS = 2;

// Due dates are calendar days, so compare against the viewer's local date, not UTC's.
export function dueLabel(date: string) {
  const days = Math.round((Date.parse(date) - Date.parse(localToday())) / DAY_MS);
  if (days < 0) return { text: `${-days}d overdue`, tone: "late" };
  if (days === 0) return { text: "Due today", tone: "soon" };
  if (days <= CARD_SOON_DAYS) return { text: `Due in ${days}d`, tone: "soon" };
  return { text: shortDate(date), tone: "" };
}

/** A stored YYYY-MM-DD day as local midnight, so it formats as that same calendar day. */
export const dayOf = (iso: string) => new Date(iso + "T00:00");
export const shortDate = (iso: string) => dayOf(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const longDate = (iso: string) => dayOf(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/** D1's datetime('now') is UTC without a zone suffix. */
export const formatTimestamp = (sqlite: string) => new Date(sqlite + "Z").toLocaleString();

/** A stable colour per label, so "bug" looks the same on every card without storing colours. */
// FNV-1a spreads similar names well; 12 hues 30° apart stay easy to tell apart.
const labelHue = (name: string) => {
  let hash = 2166136261;
  for (const ch of name) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (hash % 12) * 30;
};

export function LabelChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <span className="label-chip" style={{ "--hue": labelHue(name) } as CSSProperties}>
      {name}
      {onRemove && (
        <button type="button" aria-label={`Remove label ${name}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

/** Type a label and press Enter or comma; known labels are suggested. */
export function LabelInput({ value, known, onChange }: { value: string[]; known: string[]; onChange: (labels: string[]) => void }) {
  const [text, setText] = useState("");

  function add() {
    const label = normalizeLabel(text);
    if (label && !value.includes(label) && value.length < MAX_LABELS) onChange([...value, label]);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="label-input">
      {value.map((label) => (
        <LabelChip key={label} name={label} onRemove={() => onChange(value.filter((l) => l !== label))} />
      ))}
      {value.length < MAX_LABELS && (
        <input
          id="label-input"
          list="known-labels"
          aria-label="Add a label"
          placeholder={value.length ? "" : "Add a label…"}
          maxLength={MAX_LABEL_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
        />
      )}
      <datalist id="known-labels">
        {known
          .filter((l) => !value.includes(l))
          .map((l) => (
            <option key={l} value={l} />
          ))}
      </datalist>
    </div>
  );
}
