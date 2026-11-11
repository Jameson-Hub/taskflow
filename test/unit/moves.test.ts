import { describe, expect, it } from "vitest";
import type { Status } from "../../src/shared/domain";
import { keyboardMove, placeAt, positionBetween } from "../../src/shared/moves";

type Card = { id: number; status: Status; position: number };
const board: Card[] = [
  { id: 1, status: "todo", position: 1 },
  { id: 2, status: "todo", position: 2 },
  { id: 3, status: "todo", position: 3 },
  { id: 4, status: "in_progress", position: 1 },
  { id: 5, status: "in_progress", position: 2 },
];
const card = (id: number) => board.find((c) => c.id === id)!;

describe("moving a card with the keyboard", () => {
  it("moves up and down within its column", () => {
    expect(keyboardMove(board, card(2), "up")).toMatchObject({ status: "todo", position: 0 });
    expect(keyboardMove(board, card(2), "down")).toMatchObject({ status: "todo", position: 4 });
    expect(keyboardMove(board, card(1), "down")).toMatchObject({ status: "todo", position: 2.5 });
  });

  it("goes nowhere past the top or bottom of a column", () => {
    expect(keyboardMove(board, card(1), "up")).toBeNull();
    expect(keyboardMove(board, card(3), "down")).toBeNull();
  });

  it("moves to the neighbouring column at the same height", () => {
    // Second in To do lands second in In progress: after card 4, before card 5.
    expect(keyboardMove(board, card(2), "right")).toMatchObject({ status: "in_progress", position: 1.5 });
    // Third in To do lands at the bottom of a two-card column.
    expect(keyboardMove(board, card(3), "right")).toMatchObject({ status: "in_progress", position: 3 });
    expect(keyboardMove(board, card(4), "left")).toMatchObject({ status: "todo", position: 0 });
    // An empty column takes it as its only card.
    expect(keyboardMove(board, card(5), "right")).toMatchObject({ status: "done", position: 1 });
  });

  it("goes nowhere past the first or last column", () => {
    expect(keyboardMove(board, card(1), "left")).toBeNull();
    expect(keyboardMove([{ id: 9, status: "done", position: 1 }], { id: 9, status: "done", position: 1 }, "right")).toBeNull();
  });
});

describe("dropping a card at a slot", () => {
  it("lands among the column's other cards and reports its slot", () => {
    expect(placeAt(board, card(1), "in_progress", 1)).toEqual({ status: "in_progress", position: 1.5, index: 1 });
    expect(placeAt(board, card(1), "todo", 99)).toEqual({ status: "todo", position: 4, index: 2 });
  });
});

describe("slotting a card between neighbours", () => {
  it("takes the midpoint, or steps past the one neighbour there is", () => {
    expect(positionBetween({ position: 1 }, { position: 2 })).toBe(1.5);
    expect(positionBetween({ position: 4 }, undefined)).toBe(5);
    expect(positionBetween(undefined, { position: 1 })).toBe(0);
    expect(positionBetween(undefined, undefined)).toBe(1);
  });
});
