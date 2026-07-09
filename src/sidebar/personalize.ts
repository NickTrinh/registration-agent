// Implements: ADR 0032 (extracted from Message.tsx so Settings can share it)
//
// Substitute privacy placeholders emitted by the PII-free audit renderer.
// The audit text sent to Anthropic contains [NAME], [ADVISOR], and
// [ADVISOR_EMAIL] instead of identifying fields, and Claude is told to echo
// those tokens verbatim. We swap them back at render time so the chat (and
// the Settings profile card) feels personal without identifying data ever
// leaving the extension.
//
// Fallbacks:
//   [NAME] → "you" if the first name isn't available.
//   [ADVISOR] → "your advisor" if the advisor name wasn't on the audit.
//   [ADVISOR_EMAIL] → "advisor email not provided" desync fallback.
// All three real values live in chrome.storage.local (studentFirstName,
// studentAdvisorName, studentAdvisorEmail) and are populated only by the
// service worker's refreshAudit path — client-side, never sent outbound.
export function personalize(
  text: string,
  firstName: string | null,
  advisorEmail: string | null,
  advisorName: string | null
): string {
  return text
    .replaceAll("[NAME]", firstName ?? "you")
    .replaceAll("[ADVISOR]", advisorName ?? "your advisor")
    .replaceAll("[ADVISOR_EMAIL]", advisorEmail ?? "advisor email not provided");
}
