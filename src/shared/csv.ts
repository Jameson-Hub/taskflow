// The board as a CSV file for spreadsheets. Pure, so it's unit-tested on its own.
import { checklistProgress, isoDate, PRIORITY_LABEL, STATUS_LABEL, STATUSES, type Task } from "./domain";
import { columnOf } from "./moves";

/** The calendar date of a D1 timestamp (UTC, no zone suffix) for a viewer `offset` minutes behind UTC, as getTimezoneOffset() reports it. */
const localDate = (sqlite: string, offset: number) => isoDate(Date.parse(sqlite.replace(" ", "T") + "Z") - offset * 60_000);

/** Each column's header and how a task fills it, in order. */
const columns = (offset: number): [string, (t: Task) => string][] => [
  ["Title", (t) => t.title],
  ["Status", (t) => STATUS_LABEL[t.status]],
  ["Priority", (t) => PRIORITY_LABEL[t.priority]],
  ["Assignee", (t) => t.assignee?.name ?? ""],
  ["Due date", (t) => t.due_date ?? ""],
  ["Labels", (t) => t.labels.join("; ")],
  ["Checklist", (t) => (t.checklist.length > 0 ? checklistProgress(t.checklist) : "")],
  ["Description", (t) => t.description],
  ["Created", (t) => localDate(t.created_at, offset)],
  ["Updated", (t) => localDate(t.updated_at, offset)],
];

/** One CSV cell: formula-looking text is defused (a spreadsheet would run it), then quoted if it holds a comma, quote or line break. */
function csvCell(value: string) {
  const safe = /^\s*[=+\-@]|^[\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The given tasks, column by column in board order, one row each, dated in the viewer's time zone. */
export function tasksCsv(tasks: Task[], timezoneOffset = new Date().getTimezoneOffset()) {
  const cols = columns(timezoneOffset);
  const rows = STATUSES.flatMap((status) => columnOf(tasks, status)).map((t) => cols.map(([, value]) => value(t)));
  return [cols.map(([header]) => header), ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
