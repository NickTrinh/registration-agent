// DegreeWorks JSON API client for Fordham's responsiveDashboard.
// Implements: ADR 0002, ADR 0003, ADR 0004, ADR 0006 — see notes/decisions/.
//
// Runs in the extension service worker and piggybacks on the user's existing
// DegreeWorks session cookies (`X-AUTH-TOKEN`, `REFRESH_TOKEN`, `NAME`) via
// `credentials: "include"`. Same auth pattern as banner-ssb-client.ts.
//
// Three endpoints, two method variants on /api/audit:
//   GET  /api/students/myself         — bootstrap: studentId, school, degree
//   GET  /api/audit?studentId=...     — real audit (vendor Accept header!)
//   POST /api/audit                   — What-If audit (proxied through DW tab)
//
// CORS carveout for POST /api/audit: the server's CORS policy allows GET from
// any Origin but rejects POST from `chrome-extension://…` with a 403
// "Invalid CORS request" body. Confirmed via DevTools capture 2026-04-19.
// We proxy the POST through an existing DegreeWorks tab using
// `chrome.scripting.executeScript`, which runs the fetch with Origin
// `https://dw-prod.ec.fordham.edu` — same-origin, server-allowed. GET calls
// stay on the direct service-worker path.
//
// ⚠ PII: every response contains Banner ID + full name + email. Never log
// response bodies. Log lengths and IDs only.

import type {
  AuditResponse,
  Student,
  StudentsMyself,
  WhatIfGoal,
} from "../../shared/degreeworks-types";

const BASE = "https://dw-prod.ec.fordham.edu/responsiveDashboard/api";

// The audit GET endpoint REQUIRES this exact Accept header or it returns an
// error. Note `vnd.net.hedtech.*` — the `/about` endpoint uses `vnd.hedtech.*`
// (no `net.` prefix). Ellucian vendored two media-type specs; only the audit
// endpoint uses the `net` variant.
const AUDIT_VENDOR_ACCEPT =
  "application/vnd.net.hedtech.degreeworks.dashboard.audit.v1+json";

// ─── Low-level helpers ────────────────────────────────────────────────────────

// Thrown when DegreeWorks returns 401/403 — almost always session expiry.
// The sidebar catches this and renders a targeted "log back into DegreeWorks"
// banner instead of a generic red error.
export class DegreeWorksAuthError extends Error {
  constructor(path: string, status: number) {
    super(`DegreeWorks auth failed on ${path} (${status}). Session likely expired.`);
    this.name = "DegreeWorksAuthError";
  }
}

// Thrown when a What-If proxy call runs but no DegreeWorks tab is open to
// inject into. The sidebar catches this and asks the user to open DW first.
export class DegreeWorksNoTabError extends Error {
  constructor() {
    super("No DegreeWorks tab open. Open DegreeWorks in a tab and retry.");
    this.name = "DegreeWorksNoTabError";
  }
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

async function getJSON<T>(path: string, accept = "application/json"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { Accept: accept },
  });
  if (!res.ok) {
    if (isAuthStatus(res.status)) throw new DegreeWorksAuthError(path, res.status);
    throw new Error(`DegreeWorks GET ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Bootstrap: the student's id + active term + active goals (school, degree,
// catalog year). Use the first goal entry unless you're handling dual-degree
// students (rare).
export async function fetchStudentMyself(): Promise<Student> {
  const envelope = await getJSON<StudentsMyself>("/students/myself");
  const student = envelope._embedded?.students?.[0];
  if (!student) {
    throw new Error("DegreeWorks /students/myself returned no student");
  }
  return student;
}

export interface FetchAuditParams {
  studentId: string;
  school: string;                 // "U" = undergraduate
  degree: string;                 // "BS" | "BA" | ...
  auditId?: string;               // blank = latest
  includeInProgress?: boolean;    // default true
  includePreregistered?: boolean; // default true
}

// Fetch the student's current regular audit. Requires the vendor media type
// in the Accept header — plain `application/json` returns an error page.
export async function fetchCurrentAudit(p: FetchAuditParams): Promise<AuditResponse> {
  const params = new URLSearchParams({
    studentId: p.studentId,
    school: p.school,
    degree: p.degree,
    "is-process-new": "false",
    "audit-type": "AA",
    auditId: p.auditId ?? "",
    "include-inprogress": String(p.includeInProgress ?? true),
    "include-preregistered": String(p.includePreregistered ?? true),
    "aid-term": "",
  });

  return getJSON<AuditResponse>(`/audit?${params}`, AUDIT_VENDOR_ACCEPT);
}

export interface WhatIfOptions {
  school?: string;                // default "U"
  degree?: string;                // default "BS"
  catalogYear?: string;           // default "2024" — string, not number
  classes?: Array<{ discipline: string; number: string }>;  // Look-Ahead hook
  keepCurriculum?: boolean;       // default false (throw away real curriculum)
}

// Run a What-If audit: swap one or more curriculum goals and recompute.
// Returns the same shape as fetchCurrentAudit — `auditHeader.whatIf === "Y"`
// is the discriminator.
//
// Routing: POST /api/audit 403s with "Invalid CORS request" when called from
// the service-worker's `chrome-extension://` Origin. We inject the fetch into
// a live DegreeWorks tab via `chrome.scripting.executeScript`, which runs
// with the page's Origin and is server-allowed. Throws DegreeWorksNoTabError
// if no dw-prod tab is open.
export async function fetchWhatIfAudit(
  studentId: string,
  goals: WhatIfGoal[],
  opts: WhatIfOptions = {}
): Promise<AuditResponse> {
  const body = {
    studentId,
    isIncludeInprogress: true,
    isIncludePreregistered: true,
    isKeepCurriculum: opts.keepCurriculum ?? false,
    school: opts.school ?? "U",
    degree: opts.degree ?? "BS",
    catalogYear: opts.catalogYear ?? "2024",
    goals: goals.map((g) => ({
      code: g.code,
      value: g.value,
      catalogYear: g.catalogYear ?? "",
    })),
    classes: opts.classes ?? [],
  };

  const tabs = await chrome.tabs.query({ url: "https://dw-prod.ec.fordham.edu/*" });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) throw new DegreeWorksNoTabError();

  // Run the POST from the DW tab's ISOLATED world. Same origin as the page,
  // same cookies via credentials:include, but insulated from the page's JS
  // globals — we don't want to read or disturb DW's React state.
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [body],
    func: async (reqBody: unknown) => {
      try {
        const res = await fetch("/responsiveDashboard/api/audit", {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reqBody),
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, statusText: res.statusText, text };
      } catch (e) {
        return { ok: false, status: 0, statusText: "fetch-threw", text: (e as Error).message };
      }
    },
  });

  const result = injection?.result as
    | { ok: boolean; status: number; statusText: string; text: string }
    | undefined;
  if (!result) throw new Error("What-If proxy returned no result from DegreeWorks tab.");
  if (!result.ok) {
    if (isAuthStatus(result.status)) throw new DegreeWorksAuthError("/audit (proxy)", result.status);
    throw new Error(`DegreeWorks POST /audit (proxy) → ${result.status} ${result.statusText}`);
  }
  return JSON.parse(result.text) as AuditResponse;
}
