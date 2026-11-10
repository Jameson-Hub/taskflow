import { useCallback, useState } from "react";

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

/** D1's datetime('now') is UTC without a zone suffix. */
export const formatTimestamp = (sqlite: string) => new Date(sqlite + "Z").toLocaleString();
