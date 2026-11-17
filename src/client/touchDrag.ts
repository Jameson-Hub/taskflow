import { useEffect, useEffectEvent, type RefObject } from "react";

/** How long a finger rests on a card before it lifts, and how far it may wander first (further means a scroll). */
const HOLD_MS = 350;
const SLOP_PX = 10;
/** Holding a card this close to the top or bottom of the screen scrolls the page, so far columns are reachable. */
const EDGE_PX = 60;

/** Phones and tablets: no hover, so the browser's built-in drag (mouse only) is left off and touch takes over. */
export const touchFirst = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;

export type TouchDragHandlers = {
  /** The card a hold on this element picks up, or null when it can't be moved. */
  pick: (card: HTMLElement) => number | null;
  start: (id: number) => void;
  /** The finger is at this point on screen (client coordinates). */
  over: (x: number, y: number) => void;
  drop: () => void;
  cancel: () => void;
};

/**
 * Press-and-hold dragging for touch screens, where the HTML drag events never fire.
 * The held card follows the finger; letting go drops it and doesn't count as a tap.
 */
export function useTouchDrag(root: RefObject<HTMLElement | null>, handlers: TouchDragHandlers) {
  const pick = useEffectEvent(handlers.pick);
  const start = useEffectEvent(handlers.start);
  const over = useEffectEvent(handlers.over);
  const drop = useEffectEvent(handlers.drop);
  const cancel = useEffectEvent(handlers.cancel);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let card: HTMLElement | null = null;
    let timer = 0;
    let frame = 0;
    let active = false;
    let moved = false;
    let x0 = 0, y0 = 0, scroll0 = 0, x = 0, y = 0;

    // Once a frame while a card is held: scroll near an edge, then aim and move the card if anything changed.
    const tick = () => {
      const speed = y < EDGE_PX ? y - EDGE_PX : y > innerHeight - EDGE_PX ? y - (innerHeight - EDGE_PX) : 0;
      if (speed) scrollBy(0, speed / 4);
      if (card && (moved || speed)) {
        over(x, y); // layout reads first, then the style write, so no forced reflow
        card.style.transform = `translate(${x - x0}px, ${y - y0 + scrollY - scroll0}px)`;
        moved = false;
      }
      frame = requestAnimationFrame(tick);
    };

    const LIFTED = { transform: "", pointerEvents: "none", zIndex: "10", opacity: "0.85" };
    const reset = () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      if (card) Object.assign(card.style, Object.fromEntries(Object.keys(LIFTED).map((key) => [key, ""])));
      card = null;
      active = moved = false;
    };

    const onStart = (e: TouchEvent) => {
      if (active) cancel(); // a second finger mid-drag calls it off
      reset();
      const target = e.touches.length === 1 && (e.target as Element).closest<HTMLElement>("[data-task]");
      // A card the browser can drag itself (touchscreen laptops) is left to the browser, so it never moves twice.
      if (target && target.draggable) return;
      const id = target ? pick(target) : null;
      if (!target || id === null) return;
      card = target;
      ({ clientX: x0, clientY: y0 } = e.touches[0]!);
      [x, y, scroll0] = [x0, y0, scrollY];
      timer = window.setTimeout(() => {
        active = true;
        Object.assign(target.style, LIFTED);
        start(id);
        frame = requestAnimationFrame(tick);
      }, HOLD_MS);
    };

    const onMove = (e: TouchEvent) => {
      const finger = e.touches[0];
      if (!card || !finger) return;
      ({ clientX: x, clientY: y } = finger);
      if (!active) {
        if (Math.hypot(x - x0, y - y0) > SLOP_PX) reset(); // moved before the hold: it's a scroll
        return;
      }
      e.preventDefault(); // the page stays put while a card is held
      moved = true;
    };

    const onEnd = (e: TouchEvent) => {
      if (active) {
        e.preventDefault(); // no click, so the task doesn't open
        over(x, y); // where the finger let go, even if no frame has caught up yet
        drop();
      }
      reset();
    };

    const onCancel = () => {
      if (active) cancel();
      reset();
    };

    // A long press would otherwise bring up the copy/share menu, or start selecting text, instead of lifting the card.
    const onMenu = (e: Event) => card && e.preventDefault();

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onCancel);
    el.addEventListener("contextmenu", onMenu);
    document.addEventListener("selectstart", onMenu);
    return () => {
      document.removeEventListener("selectstart", onMenu);
      reset();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
      el.removeEventListener("contextmenu", onMenu);
    };
  }, [root]);
}
