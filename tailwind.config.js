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
            deep: "#5A1616",    // header fill in dark mode (13.45:1 with white)
          },
          // Accent only: 2.29:1 on white fails even the 3:1 UI-component floor.
          // Legible solely against maroon (5.12:1) — nav underline, header rings.
          gold: "#C8A84B",
        },
      },
      // Motion marks a state transition; it never decorates. Three enters and
      // one indeterminate sweep are the whole animation budget — all silenced
      // by the prefers-reduced-motion block in styles.css.
      keyframes: {
        "toast-pop": {
          "0%": { opacity: "0", transform: "translateY(6px) scale(0.96)" },
          "60%": { opacity: "1", transform: "translateY(-1px) scale(1.02)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        // A message entering the page — 4px of lift, nothing bouncy.
        "msg-in": {
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
        "msg-in": "msg-in 0.2s ease-out",
        sweep: "sweep 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
