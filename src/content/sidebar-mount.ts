// Injects a floating hint button into the DegreeWorks page.
// The actual sidebar runs as a Chrome Side Panel (outside the host page's CSP).
// Clicking the toolbar extension icon opens/closes it.

const BADGE_ID = "fordham-helper-badge";

function mountBadge(): void {
  if (document.getElementById(BADGE_ID)) return;

  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.innerHTML = `
    <span style="font-size:18px;line-height:1">🎓</span>
    <span style="font-size:12px;font-weight:600;letter-spacing:0.01em">Helper</span>
    <span style="font-size:10px;opacity:0.75;margin-top:1px">Click toolbar icon →</span>
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

  // Fade out after 5 seconds — it's just a hint
  setTimeout(() => {
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
