// Where a card lands when it's dragged or moved with the keyboard. Pure, so it's unit-tested on its own.
import { STATUSES, type Status } from "./domain";

type Placed = { id: number; status: Status; position: number };
export type Direction = "up" | "down" | "left" | "right";
/** Where a card lands: its column, its new position value, and its slot from the top (0-based). */
export type Placement = { status: Status; position: number; index: number };

/** The board's card order: by position, ties broken by id (the same as the API's ORDER BY t.position, t.id). */
export const byBoardOrder = (a: Placed, b: Placed) => a.position - b.position || a.id - b.id;

export const columnOf = <T extends Placed>(cards: T[], status: Status) => cards.filter((c) => c.status === status).sort(byBoardOrder);

/** Position that slots a card between its new neighbours without renumbering the column. */
export function positionBetween(before?: { position: number }, after?: { position: number }) {
  if (before && after) return (before.position + after.position) / 2;
  if (before) return before.position + 1;
  if (after) return after.position - 1;
  return 1;
}

/** Where `card` lands when put in `status` at slot `index`, among that column's other cards. Used by drag and keyboard alike. */
export function placeAt(cards: Placed[], card: Placed, status: Status, index: number): Placement {
  const others = columnOf(cards, status).filter((c) => c.id !== card.id);
  const slot = Math.max(0, Math.min(index, others.length));
  return { status, position: positionBetween(others[slot - 1], others[slot]), index: slot };
}

/**
 * Where a card goes when moved with the keyboard: up or down one place in its column, or to the
 * neighbouring column at the same height. Null when there's nowhere to go.
 */
export function keyboardMove(cards: Placed[], card: Placed, direction: Direction): Placement | null {
  const own = columnOf(cards, card.status);
  const index = own.findIndex((c) => c.id === card.id);

  if (direction === "up" || direction === "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= own.length) return null;
    return placeAt(cards, card, card.status, target);
  }

  const status = STATUSES[STATUSES.indexOf(card.status) + (direction === "left" ? -1 : 1)];
  return status ? placeAt(cards, card, status, index) : null;
}
