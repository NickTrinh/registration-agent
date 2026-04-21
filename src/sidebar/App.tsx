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
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-fordham-maroon text-white shadow-sm shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">🎓 Fordham Helper</span>
        </div>
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
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
        active
          ? "bg-white text-fordham-maroon dark:bg-gray-100"
          : "text-white/80 hover:text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
