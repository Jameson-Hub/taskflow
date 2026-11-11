/** Work that must reach the server while the session still exists, such as a delete waiting out its undo window. */
const pending = new Set<() => Promise<unknown>>();

export function beforeSignOut(task: () => Promise<unknown>) {
  pending.add(task);
  return () => void pending.delete(task);
}

export const settleBeforeSignOut = () => Promise.allSettled([...pending].map((task) => task()));
