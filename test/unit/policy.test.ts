import { describe, expect, it } from "vitest";
import { can } from "../../src/shared/policy";

const admin = { id: 1, role: "admin" } as const;
const manager = { id: 2, role: "manager" } as const;
const member = { id: 3, role: "member" } as const;

const othersTask = { created_by: 2, assignee_id: 4 };
const createdByMember = { created_by: 3, assignee_id: 4 };
const assignedToMember = { created_by: 2, assignee_id: 3 };

describe("editing a task", () => {
  it("leads can edit any task", () => {
    expect(can.editTask(admin, othersTask)).toBe(true);
    expect(can.editTask(manager, othersTask)).toBe(true);
  });

  it("members can edit tasks they created or are assigned to, and nothing else", () => {
    expect(can.editTask(member, createdByMember)).toBe(true);
    expect(can.editTask(member, assignedToMember)).toBe(true);
    expect(can.editTask(member, othersTask)).toBe(false);
  });
});

describe("assigning a task", () => {
  it("members may assign to themselves or leave it unassigned", () => {
    expect(can.assign(member, 3)).toBe(true);
    expect(can.assign(member, null)).toBe(true);
    expect(can.assign(member, 4)).toBe(false);
  });

  it("leads may assign to anyone", () => {
    expect(can.assign(manager, 4)).toBe(true);
    expect(can.assign(admin, 3)).toBe(true);
  });
});

describe("role-gated actions", () => {
  it.each([
    ["deleteTask", { admin: true, manager: true, member: false }],
    ["reassign", { admin: true, manager: true, member: false }],
    ["viewActivity", { admin: true, manager: true, member: false }],
    ["manageTeam", { admin: true, manager: false, member: false }],
  ] as const)("%s", (action, expected) => {
    expect({ admin: can[action](admin), manager: can[action](manager), member: can[action](member) }).toEqual(expected);
  });
});

describe("deleting a comment", () => {
  it("authors can delete their own; only admins can delete anyone's", () => {
    expect(can.deleteComment(member, 3)).toBe(true);
    expect(can.deleteComment(member, 2)).toBe(false);
    expect(can.deleteComment(manager, 3)).toBe(false);
    expect(can.deleteComment(admin, 3)).toBe(true);
  });
});

