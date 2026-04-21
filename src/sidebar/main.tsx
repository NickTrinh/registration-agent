import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { applyTheme, loadThemePreference } from "./theme";

// Resolve and apply the theme BEFORE React renders so there's no flash of
// light content on load. Theme tracking of "system" changes is handled in
// App.tsx via watchSystemTheme.
loadThemePreference().then((pref) => {
  applyTheme(pref);
  const root = document.getElementById("root")!;
  createRoot(root).render(<App />);
});
