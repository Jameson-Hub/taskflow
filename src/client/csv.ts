import { tasksCsv } from "../shared/csv";
import type { Task } from "./api";
import { localToday } from "./ui";

/** Saves the tasks as taskflow-<today>.csv. The byte-order mark makes Excel read names with accents correctly. */
export function downloadCsv(tasks: Task[]) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", tasksCsv(tasks)], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `taskflow-${localToday()}.csv` });
  link.click();
  // Safari can still be reading the file right after the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
