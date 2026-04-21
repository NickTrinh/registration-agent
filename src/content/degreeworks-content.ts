// Detects the DegreeWorks tab and tells the service worker to fetch the audit
// via the JSON API. No DOM scraping — the React SPA's DOM is empty.
// Implements: ADR 0002, ADR 0003 — see notes/decisions/.
//
// The service worker owns all API calls; this script exists only because a
// content script is the only place where we can reliably know the user is
// currently looking at DegreeWorks (service workers don't get page events).

chrome.runtime.sendMessage({ type: "REFRESH_AUDIT" });
