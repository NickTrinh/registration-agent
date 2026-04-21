// Theme preference: 3-state toggle (light / dark / system).
//
// - "light" / "dark" — explicit override; ignores OS setting
// - "system" (default) — follows prefers-color-scheme and tracks live changes
//
// Stored in chrome.storage.local under THEME_KEY. The `dark` class on
// <html> drives Tailwind's dark variants (see tailwind.config.js →
// darkMode: "class").

export type ThemePreference = "light" | "dark" | "system";
export const THEME_KEY = "themePreference";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function resolveDark(pref: ThemePreference): boolean {
  if (pref === "dark") return true;
  if (pref === "light") return false;
  return systemPrefersDark();
}

export function applyTheme(pref: ThemePreference): void {
  const dark = resolveDark(pref);
  document.documentElement.classList.toggle("dark", dark);
}

// Keep the DOM `dark` class in sync with OS dark-mode changes — but only
// when the student's preference is "system". Returns a cleanup function.
export function watchSystemTheme(getCurrentPref: () => ThemePreference): () => void {
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mql) return () => {};
  const handler = () => {
    if (getCurrentPref() === "system") applyTheme("system");
  };
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

export async function loadThemePreference(): Promise<ThemePreference> {
  return new Promise((resolve) => {
    chrome.storage.local.get(THEME_KEY, (r) => {
      const v = r[THEME_KEY];
      if (v === "light" || v === "dark" || v === "system") resolve(v);
      else resolve("system");
    });
  });
}

export async function saveThemePreference(pref: ThemePreference): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [THEME_KEY]: pref }, () => resolve());
  });
}
