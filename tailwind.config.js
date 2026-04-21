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
          maroon: "#6B1A1A",
          gold: "#C8A84B",
        },
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "toast-pop": {
          "0%": { opacity: "0", transform: "translateY(6px) scale(0.96)" },
          "60%": { opacity: "1", transform: "translateY(-1px) scale(1.02)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "toast-pop": "toast-pop 0.25s ease-out",
      },
    },
  },
  plugins: [],
};
