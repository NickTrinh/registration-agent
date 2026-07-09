// Implements: ADR 0031 (native-app surface grammar — chrome + navigation)
import { useState, useEffect, useRef, type ReactNode } from "react";
import AuditChat from "./pages/AuditChat";
import Settings from "./pages/Settings";
import {
  applyTheme,
  loadThemePreference,
  watchSystemTheme,
  type ThemePreference,
  THEME_KEY,
} from "./theme";

type Page = "chat" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("chat");

  // Keep a ref to the current theme preference so watchSystemTheme can
  // decide whether to re-apply on OS changes without triggering re-renders.
  const themeRef = useRef<ThemePreference>("system");
  useEffect(() => {
    loadThemePreference().then((pref) => {
      themeRef.current = pref;
    });
    // Live OS dark-mode tracking — only fires if the student's preference
    // is "system"; explicit light/dark overrides stay fixed.
    const unwatch = watchSystemTheme(() => themeRef.current);
    // Also listen for our own storage broadcasts so a theme change from
    // the Settings tab applies immediately everywhere.
    const onStorageChange = (changes: {
      [key: string]: chrome.storage.StorageChange;
    }) => {
      if (changes[THEME_KEY]) {
        const next = changes[THEME_KEY].newValue as ThemePreference | undefined;
        if (next === "light" || next === "dark" || next === "system") {
          themeRef.current = next;
          applyTheme(next);
        }
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => {
      unwatch();
      chrome.storage.onChanged.removeListener(onStorageChange);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* Native-app chrome (ADR 0031): a light translucent bar with a hairline,
          not a solid maroon slab — the brand lives in the maroon serif
          wordmark and every accent below, the way Messages carries blue
          without painting its navigation bar blue. backdrop-blur matters the
          moment content scrolls beneath the bar. */}
      <header className="flex items-center justify-between pl-4 pr-2 py-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200/70 dark:border-gray-800 shrink-0 z-10">
        {/* Tailwind's stock `font-serif` — no webfont, no dependency, on every
            machine. Maroon ink on the light bar; `maroon.ink` on dark. */}
        <span className="font-serif text-[16px] font-semibold tracking-tight text-fordham-maroon dark:text-fordham-maroon-ink select-none">
          RamPlan
        </span>
        {/* iOS segmented control: gray track, raised active segment. */}
        <nav
          className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5"
          aria-label="Pages"
        >
          <NavButton active={page === "chat"} onClick={() => setPage("chat")}>
            Advisor
          </NavButton>
          <NavButton active={page === "settings"} onClick={() => setPage("settings")}>
            Settings
          </NavButton>
        </nav>
      </header>

      {/* Page Content — both pages stay mounted so the AuditChat's
          onMessage listener keeps receiving AI_CHUNK broadcasts even
          while the user is on the Settings tab mid-stream. display:none
          cancels CSS animations, so animate-page-in replays on each
          re-show — the tab switch settles instead of snapping. */}
      <main className="flex-1 overflow-hidden relative">
        <div
          className="absolute inset-0 flex flex-col animate-page-in"
          style={{ display: page === "chat" ? "flex" : "none" }}
        >
          <AuditChat onOpenSettings={() => setPage("settings")} />
        </div>
        <div
          className="absolute inset-0 animate-page-in"
          style={{ display: page === "settings" ? "block" : "none" }}
        >
          <Settings />
        </div>
      </main>
    </div>
  );
}

function NavButton({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`focus-ring rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
        active
          ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-50 shadow-sm"
          : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
