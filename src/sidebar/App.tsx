// Implements: ADR 0031 (native-app surface grammar — chrome + navigation)
// Implements: ADR 0032 (warm-paper chrome, bundled grotesque wordmark)
// Implements: ADR 0036 (Fordhawke crest logo + upright Newsreader nameplate)
import { useState, useEffect, useRef, type ReactNode } from "react";
import AuditChat from "./pages/AuditChat";
import Settings from "./pages/Settings";
import logoUrl from "../../tools/mascot/assets/logo.png";
import logoDarkUrl from "../../tools/mascot/assets/logo-dark.png";
import {
  applyTheme,
  loadThemePreference,
  watchSystemTheme,
  type ThemePreference,
  THEME_KEY,
} from "./theme";

type Page = "chat" | "settings";

export default function App() {
  // Initial page honors ?page=settings — inert in the extension (the panel
  // URL carries no query) but lets the dev harness screenshot Settings
  // without scripting a click.
  const [page, setPage] = useState<Page>(() =>
    new URLSearchParams(window.location.search).get("page") === "settings"
      ? "settings"
      : "chat"
  );

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
    <div className="flex flex-col h-screen bg-stone-50 dark:bg-stone-900">
      {/* Native-app chrome (ADR 0031): a light translucent bar with a hairline,
          not a solid maroon slab — the brand lives in the maroon serif
          wordmark and every accent below, the way Messages carries blue
          without painting its navigation bar blue. backdrop-blur matters the
          moment content scrolls beneath the bar. */}
      <header className="flex items-center justify-between pl-4 pr-2 py-2 bg-stone-50/80 dark:bg-stone-900/80 backdrop-blur-md border-b border-stone-200/70 dark:border-stone-800 shrink-0 z-10">
        {/* Brand lockup: the single "Ram Plan" logo image — the pixel-art
            Fordhawke head + a fountain-pen cursive wordmark, baked as one asset.
            It supersedes the 0036 crest-plus-Newsreader pairing: head and
            nameplate ship as one lockup, so the header carries one mark.
            Two bakes, not a CSS filter: logo.png (brown cursive) for light,
            logo-dark.png (cream cursive, ~13:1 on stone-900) for dark — the
            head and gold flourish are identical in both. Toggled by the .dark
            class, the same class-based mechanism the whole app themes on (a
            <picture>/prefers-color-scheme swap would ignore the explicit
            light/dark override in Settings). `hidden` is display:none, so the
            inactive bake is out of the a11y tree — same alt on both, but only
            the shown one ever announces. */}
        <img
          src={logoUrl}
          alt="Ram Plan"
          className="h-7 w-auto select-none dark:hidden"
        />
        <img
          src={logoDarkUrl}
          alt="Ram Plan"
          className="hidden h-7 w-auto select-none dark:block"
        />
        {/* iOS segmented control: recessed track, raised active segment.
            stone-200/70 — stone-100 vanished against the stone-50 bar. */}
        <nav
          className="flex rounded-lg bg-stone-200/70 dark:bg-stone-800 p-0.5"
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
          ? "bg-white dark:bg-stone-600 text-stone-900 dark:text-stone-50 shadow-sm"
          : "text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200"
      }`}
    >
      {children}
    </button>
  );
}
