import { useContext, useEffect } from "react";
import { IDLE_INPUT, type PlayerInput } from "@tank-arena/shared";
import type { GameRoom } from "../net/client.ts";
import { KeyBindingsContext } from "./keyBindings.ts";

function axis(neg: boolean, pos: boolean): -1 | 0 | 1 {
  if (neg === pos) return 0;
  return pos ? 1 : -1;
}

function sameInput(a: PlayerInput, b: PlayerInput): boolean {
  return a.throttle === b.throttle && a.turn === b.turn && a.fire === b.fire;
}

/**
 * Translates held keys into a `PlayerInput` and sends it to the server whenever
 * it changes. The server only ever receives intents; it decides what happens.
 * Which keys count comes from `KeyBindingsContext`, so several rooms on one page
 * can each listen to their own set.
 */
export function useKeyboardInput(room: GameRoom, active: boolean): void {
  const bindings = useContext(KeyBindingsContext);

  useEffect(() => {
    if (!active) return;

    const FORWARD = new Set(bindings.forward);
    const BACK = new Set(bindings.back);
    const LEFT = new Set(bindings.left);
    const RIGHT = new Set(bindings.right);
    const FIRE = new Set(bindings.fire);

    const held = new Set<string>();
    let last: PlayerInput = IDLE_INPUT;

    const push = () => {
      const next: PlayerInput = {
        throttle: axis([...held].some((k) => BACK.has(k)), [...held].some((k) => FORWARD.has(k))),
        turn: axis([...held].some((k) => LEFT.has(k)), [...held].some((k) => RIGHT.has(k))),
        fire: [...held].some((k) => FIRE.has(k)),
      };
      if (sameInput(next, last)) return;
      last = next;
      room.send("input", next);
    };

    const isGameKey = (code: string) =>
      FORWARD.has(code) || BACK.has(code) || LEFT.has(code) || RIGHT.has(code) || FIRE.has(code);

    const onDown = (e: KeyboardEvent) => {
      if (!isGameKey(e.code) || isTyping(e.target)) return;
      e.preventDefault();
      held.add(e.code);
      push();
    };
    const onUp = (e: KeyboardEvent) => {
      if (!held.delete(e.code)) return;
      e.preventDefault();
      push();
    };
    const release = () => {
      held.clear();
      push();
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
      release();
    };
  }, [room, active, bindings]);
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
