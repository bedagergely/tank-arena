/**
 * Reusable Tailwind class strings for buttons and form fields. These replace the
 * daisyUI component classes (`btn`, `input`, `select`, `card` …) that the app
 * used to depend on, so the client ships nothing but Tailwind.
 *
 * Buttons are split into a size/shape base (`BTN`) plus a colour variant so the
 * utilities never fight over the same property.
 */

export const BTN =
  "inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-4 text-sm font-semibold transition-colors duration-200 select-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:border-transparent disabled:text-base-content/20";

export const BTN_DEFAULT =
  "border-transparent bg-base-200 text-base-content hover:bg-base-100 focus-visible:outline-base-content disabled:bg-base-content/10";
export const BTN_PRIMARY =
  "border-primary bg-primary text-primary-content hover:brightness-95 focus-visible:outline-primary disabled:bg-base-content/10";
export const BTN_GHOST =
  "border-transparent bg-transparent text-base-content hover:bg-base-200 focus-visible:outline-base-content disabled:bg-transparent";

export const BTN_SM = "h-8 gap-1.5 px-3 text-xs";
export const BTN_XS = "h-6 gap-1 px-2 text-[0.6875rem]";

const FIELD =
  "rounded-lg border border-base-content/20 bg-base-100 text-base-content outline-none transition-colors placeholder:text-base-content/50 focus:border-base-content focus:outline-2 focus:outline-offset-2 focus:outline-base-content";

export const INPUT = `inline-flex h-10 px-3 text-sm ${FIELD}`;
export const INPUT_SM = `inline-flex h-8 px-3 text-xs ${FIELD}`;
export const SELECT = `inline-flex h-10 cursor-pointer appearance-none pl-3 pr-7 text-sm select-field ${FIELD}`;
export const SELECT_SM = `inline-flex h-8 cursor-pointer appearance-none pl-3 pr-7 text-xs select-field ${FIELD}`;

export const CARD = "flex flex-col rounded-xl border border-base-300 bg-base-200/80 shadow-lg shadow-black/30";
export const CARD_BODY = "flex flex-auto flex-col text-sm";
