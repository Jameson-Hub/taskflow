import { describe, expect, it } from "vitest";
import { tasksCsv } from "../../src/shared/csv";
import type { Task } from "../../src/shared/domain";

const task = (over: Partial<Task>): Task => ({
  id: 1,
  title: "Write docs",
  description: "",
  status: "todo",
  priority: "medium",
  position: 1,
  due_date: null,
  assignee: null,
  created_by: 1,
  created_at: "2026-11-01 09:30:00",
  updated_at: "2026-11-02 10:00:00",
  labels: [],
  checklist: [],
  ...over,
});

const lines = (csv: string) => csv.split("\r\n");

describe("exporting the board as CSV", () => {
  it("writes a header and one readable row per task", () => {
    const csv = tasksCsv([
      task({
        title: "Design onboarding",
        status: "in_progress",
        priority: "high",
        due_date: "2026-11-20",
        assignee: { id: 2, name: "Sam Cruz" },
        labels: ["design", "frontend"],
        checklist: [
          { text: "Sketch", done: true },
          { text: "Review", done: false },
        ],
      }),
    ]);
    expect(lines(csv)).toEqual([
      "Title,Status,Priority,Assignee,Due date,Labels,Checklist,Description,Created,Updated",
      "Design onboarding,In progress,High,Sam Cruz,2026-11-20,design; frontend,1/2,,2026-11-01,2026-11-02",
    ]);
  });

  it("quotes commas, quotes and line breaks so spreadsheets keep each task on one row", () => {
    const [, row] = lines(tasksCsv([task({ title: 'Fix "login", again', description: "Line one\nLine two" })]));
    expect(row).toBe('"Fix ""login"", again",To do,Medium,,,,,"Line one\nLine two",2026-11-01,2026-11-02');
  });

  it("stops a cell from running as a spreadsheet formula", () => {
    const [, row] = lines(tasksCsv([task({ title: '=HYPERLINK("http://x")', description: "@SUM(A1)" })]));
    expect(row!.startsWith(`"'=HYPERLINK(""http://x"")"`)).toBe(true);
    expect(row).toContain(",'@SUM(A1),");
    // Spreadsheets trim leading spaces before deciding it's a formula.
    expect(lines(tasksCsv([task({ title: "  =1+1" })]))[1]!.startsWith("'  =1+1,")).toBe(true);
  });

  it("dates tasks in the viewer's time zone, not the server's UTC", () => {
    // 20:30 UTC on Nov 1 is already Nov 2 in Manila (UTC+8; getTimezoneOffset() is -480 there).
    const [, row] = lines(tasksCsv([task({ created_at: "2026-11-01 20:30:00", updated_at: "2026-11-01 15:00:00" })], -480));
    expect(row!.endsWith(",2026-11-02,2026-11-01")).toBe(true);
  });

  it("lists tasks column by column, in board order", () => {
    const csv = tasksCsv([
      task({ id: 1, title: "Done one", status: "done", position: 1 }),
      task({ id: 2, title: "Second", status: "todo", position: 2 }),
      task({ id: 3, title: "First", status: "todo", position: 1 }),
      task({ id: 4, title: "Doing", status: "in_progress", position: 1 }),
    ]);
    expect(lines(csv).slice(1).map((r) => r.split(",")[0])).toEqual(["First", "Second", "Doing", "Done one"]);
  });
});
