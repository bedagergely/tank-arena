import { createContext } from "react";

export interface KeyBindings {
  forward: readonly string[];
  back: readonly string[];
  left: readonly string[];
  right: readonly string[];
  fire: readonly string[];
  /** Human-readable hint shown in the UI. */
  hint: string;
}

export const WASD_BINDINGS: KeyBindings = {
  forward: ["KeyW"],
  back: ["KeyS"],
  left: ["KeyA"],
  right: ["KeyD"],
  fire: ["Space"],
  hint: "Move: W/S · Turn: A/D · Fire: Space",
};

export const ARROW_BINDINGS: KeyBindings = {
  forward: ["ArrowUp"],
  back: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  fire: ["Enter"],
  hint: "Move: ↑/↓ · Turn: ←/→ · Fire: Enter",
};

/** Normal play: either layout works. */
export const DEFAULT_BINDINGS: KeyBindings = {
  forward: [...WASD_BINDINGS.forward, ...ARROW_BINDINGS.forward],
  back: [...WASD_BINDINGS.back, ...ARROW_BINDINGS.back],
  left: [...WASD_BINDINGS.left, ...ARROW_BINDINGS.left],
  right: [...WASD_BINDINGS.right, ...ARROW_BINDINGS.right],
  fire: [...WASD_BINDINGS.fire, ...ARROW_BINDINGS.fire],
  hint: "Move: W/S or ↑/↓ · Turn: A/D or ←/→ · Fire: Space or Enter",
};

export const KeyBindingsContext = createContext<KeyBindings>(DEFAULT_BINDINGS);
