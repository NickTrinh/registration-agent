// Injects a floating hint button into the DegreeWorks page.
// The actual sidebar runs as a Chrome Side Panel (outside the host page's CSP).
// Clicking the toolbar extension icon opens/closes it.

const BADGE_ID = "fordham-helper-badge";

function mountBadge(): void {
  if (document.getElementById(BADGE_ID)) return;

  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.innerHTML = `
    <span style="font-family:ui-serif,Georgia,'Times New Roman',serif;font-size:15px;font-weight:600;letter-spacing:-0.01em">RamPlan</span>
    <span style="font-size:11px;opacity:0.8;margin-top:1px">Click toolbar icon →</span>
  `;
  Object.assign(badge.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: "2147483647",
    background: "#6B1A1A",
    color: "#fff",
    border: "none",
    borderRadius: "12px",
    padding: "8px 14px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
    fontFamily: "system-ui, sans-serif",
    cursor: "default",
    userSelect: "none",
  });

  document.body.appendChild(badge);

  // Fade out after 5 seconds — it's just a hint. This badge lives on the host
  // page, so the extension's own reduced-motion stylesheet can't reach it.
  const reduceMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  setTimeout(() => {
    if (reduceMotion) {
      badge.remove();
      return;
    }
    badge.style.transition = "opacity 0.5s ease";
    badge.style.opacity = "0";
    setTimeout(() => badge.remove(), 500);
  }, 5000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountBadge);
} else {
  mountBadge();
}
