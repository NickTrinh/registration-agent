// Dev-only entry: install the chrome.* mock BEFORE the real sidebar entry
// evaluates (main.tsx calls chrome.storage at module scope via
// loadThemePreference). Dynamic import guarantees the ordering.
import { installChromeMock } from "./chrome-mock";

installChromeMock();
import("../main");
