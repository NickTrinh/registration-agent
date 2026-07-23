// Dev-only entry: install the chrome.* mock BEFORE the real sidebar entry
// evaluates (main.tsx calls chrome.storage at module scope via
// loadThemePreference). Dynamic import guarantees the ordering.
import { installChromeMock } from "./chrome-mock";

installChromeMock();
import("../main").then(maybeAutosend);

// ─── Autosend (dev harness only) ──────────────────────────────────────────────
// Some scenarios (error, toolcap) only reveal their UI in response to a *sent*
// message — their reply plays via the mock's onChat script, which needs a real
// AI_CHAT to fire. A static screenshot can't type, so ?autosend drives the real
// composer once the app has mounted: `?state=error&autosend` sends a default
// probe; `?state=error&autosend=Hi` sends custom text. Dev-only — dev.html is
// not in manifest.json, so @crxjs never bundles this path.
function maybeAutosend(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("autosend")) return;
  const text = params.get("autosend") || "What core requirements am I missing?";

  // The composer is controlled by React (value={input}), so assigning
  // textarea.value is ignored — React's own state wins on the next render.
  // Drive it through the native value setter + an input event so React's
  // onChange sees the change, then dispatch Enter to trigger sendMessage.
  const setNativeValue = (el: HTMLTextAreaElement, value: string) => {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    desc?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  let tries = 0;
  const timer = setInterval(() => {
    const el = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message the advisor"]'
    );
    if (el && !el.disabled) {
      clearInterval(timer);
      setNativeValue(el, text);
      // Let React flush the controlled value before Enter reads it back.
      requestAnimationFrame(() => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
      });
    } else if (++tries > 60) {
      clearInterval(timer);
      console.warn("[autosend] composer never became ready");
    }
  }, 50);
}
