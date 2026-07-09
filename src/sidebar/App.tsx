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
      {/* The header is the brand anchor and the one element that does not move
          between themes — it stays maroon, deepening to `maroon.deep` in dark
          so it doesn't glow against a dark page (13.45:1 with white). */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-fordham-maroon dark:bg-fordham-maroon-deep text-white shadow-sm shrink-0">
        {/* Tailwind's stock `font-serif` — no webfont, no dependency, on every
            machine. It is the cheapest change that stops the panel reading as
            a generic chat app. */}
        <span className="font-serif text-[15px] font-semibold tracking-tight">
          RamPlan
        </span>
        <nav className="flex gap-1">
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
          while the user is on the Settings tab mid-stream. */}
      <main className="flex-1 overflow-hidden relative">
        <div
          className="absolute inset-0 flex flex-col"
          style={{ display: page === "chat" ? "flex" : "none" }}
        >
          <AuditChat />
        </div>
        <div
          className="absolute inset-0"
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
  // Gold appears exactly twice in the product: this 2px underline (5.12:1 on
  // maroon) and the focus ring on header controls. It fails every contrast
  // floor on white, so it never leaves this bar.
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`focus-ring-on-maroon rounded-sm px-2 py-1 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-fordham-gold text-white"
          : "border-transparent text-white/70 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
