// Implements: ADR 0025 (dark mode is a token split, not an inversion)
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  // Class-based dark mode: `dark:*` variants apply when <html> has the
  // `dark` class. The toggle in Settings adds/removes that class and
  // persists the preference to chrome.storage.local.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        fordham: {
          // Maroon FILLS everywhere; maroon WRITES only on light surfaces.
          // #6B1A1A is 11.75:1 on white but 1.51:1 on gray-900 — as an ink it
          // disappears in dark mode, so dark surfaces get `maroon.ink` instead.
          // `text-fordham-maroon` keeps resolving to DEFAULT; nothing renames.
          maroon: {
            DEFAULT: "#6B1A1A", // fill anywhere · ink on white (11.75:1)
            ink: "#D98A8A",     // ink + rules on dark surfaces (6.72:1 on gray-900)
          },
          // `deep` and `gold` were retired with the solid maroon header
          // (ADR 0031) — gold was only ever legible against that maroon.
        },
      },
      // Motion marks a state transition; it never decorates. Four enters and
      // one indeterminate sweep are the whole animation budget — all silenced
      // by the prefers-reduced-motion block in styles.css. Curves are iOS's:
      // fast start, long soft landing — never linear, never bouncy-cartoon.
      transitionTimingFunction: {
        // The UIKit sheet/spring curve. Use for anything that moves.
        spring: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        "toast-pop": {
          "0%": { opacity: "0", transform: "translateY(6px) scale(0.96)" },
          "60%": { opacity: "1", transform: "translateY(-1px) scale(1.02)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        // A message entering the page — lift + settle, like a sent iMessage:
        // a touch of scale so it lands, no overshoot.
        "msg-in": {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        // Tab switch: the incoming page settles up into place. display:none
        // cancels animations, so re-showing a kept-mounted page replays this.
        "page-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // The panel's one indeterminate indicator: a hairline sweeping the
        // status strip's bottom edge while a turn is in flight.
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
      },
      animation: {
        "toast-pop": "toast-pop 0.25s ease-out",
        "msg-in": "msg-in 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        "page-in": "page-in 0.25s cubic-bezier(0.32, 0.72, 0, 1)",
        sweep: "sweep 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
