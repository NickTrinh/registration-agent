// Banner Student Self-Service (Ellucian) client for Fordham's registration portal.
// Implements: ADR 0003, ADR 0004, ADR 0008 — see notes/decisions/.
//
// Banner's class-search API is a stateful three-step dance:
//   1. GET  /classSearch/getTerms          → list selectable terms
//   2. POST /term/search?mode=search       → bind a term to the server-side session
//   3. GET  /searchResults/searchResults   → fetch sections for the bound term
//
// Skip step 2 and step 3 silently returns []. The bind must happen once per term
// per session before any section query for that term will work.
//
// All calls run from the extension's service worker using the user's existing
// Banner session cookies (no login needed for class search — only for
// plan-ahead / registration features).

const BASE = "https://reg-prod.ec.fordham.edu/StudentRegistrationSsb/ssb";

export interface BannerTerm {
  code: string;          // e.g. "202710" (Fall 2026)
  description: string;   // e.g. "Fall 2026"
}

export interface BannerMeetingFaculty {
  meetingTime: {
    beginTime: string | null;   // "1430"
    endTime: string | null;     // "1545"
    building: string | null;
    buildingDescription: string | null;
    room: string | null;
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
    sunday: boolean;
    startDate: string | null;
    endDate: string | null;
  };
}

export interface BannerFaculty {
  displayName: string;
  primaryIndicator: boolean;
}

// Banner's `sectionAttributes` is Fordham's general-purpose requirement-tagging
// system. It covers core curriculum (e.g. AMER = American Pluralism, ICC =
// Interdisciplinary Capstone Core), major/concentration requirements (e.g. HUST
// = Humanitarian Studies, HHPA = HUST Hist/Phil/Anth req), and per-course flags.
// Every section carries 0..N of these. This is the killer field for advising
// questions like "what ICC courses also satisfy American Pluralism?".
export interface BannerSectionAttribute {
  code: string;          // e.g. "AMER", "ICC", "HUST"
  description: string;   // e.g. "American Pluralism"
  isZTCAttribute?: boolean;
  termCode?: string;
}

export interface BannerSection {
  id: number;
  term: string;
  courseReferenceNumber: string;       // CRN
  subject: string;                     // "CISC"
  courseNumber: string;                // "2010"
  subjectCourse: string;               // "CISC2010"
  courseTitle: string;
  sequenceNumber: string;              // section number e.g. "L01"
  creditHours: number | null;          // often null — real value is in creditHourLow
  creditHourLow: number | null;
  creditHourHigh: number | null;
  maximumEnrollment: number;
  enrollment: number;
  seatsAvailable: number;
  waitCapacity: number;
  waitAvailable: number;
  campusDescription: string | null;    // "Rose Hill", "Lincoln Center", "Online"
  scheduleTypeDescription: string | null;  // "Lecture", "Online"
  instructionalMethod: string | null;
  instructionalMethodDescription: string | null;
  openSection: boolean;
  faculty: BannerFaculty[];
  meetingsFaculty: BannerMeetingFaculty[];
  sectionAttributes: BannerSectionAttribute[] | null;
}

interface SearchResultsResponse {
  success: boolean;
  totalCount: number;
  data: BannerSection[];
  pageOffset: number;
  pageMaxSize: number;
  sectionsFetchedCount: number;
  ztcEncodedImage?: string;  // 50KB base64 PNG — strip before storing
}

// ─── Low-level helpers ────────────────────────────────────────────────────────

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Banner GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  const params = new URLSearchParams(body);
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Banner POST ${url} → ${res.status}`);
  return res;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getTerms(): Promise<BannerTerm[]> {
  return getJSON<BannerTerm[]>(
    `${BASE}/classSearch/getTerms?offset=1&max=100&searchTerm=`
  );
}

// Binds `term` to the server-side Banner session. Required before any
// searchResults call for that term will return data.
export async function bindTerm(term: string): Promise<void> {
  await postForm(`${BASE}/term/search?mode=search`, {
    term,
    studyPath: "",
    studyPathText: "",
    startDatepicker: "",
    endDatepicker: "",
  });
}

// Clears Banner's session-bound term filter — polite to call between
// different-term fetches within the same session.
export async function resetSession(): Promise<void> {
  await fetch(`${BASE}/classSearch/resetDataForm`, {
    method: "POST",
    credentials: "include",
  }).catch(() => { /* best-effort */ });
}

export async function listSubjects(term: string): Promise<Array<{ code: string; description: string }>> {
  return getJSON(
    `${BASE}/classSearch/get_subject?searchTerm=&term=${term}` +
      `&offset=1&max=500&uniqueSessionId=&_=${Date.now()}`
  );
}

export interface SearchOptions {
  term: string;
  subject?: string;
  pageOffset?: number;
  pageMaxSize?: number;
}

// Fetch a single page of sections. `bindTerm(term)` must have been called first.
//
// Defensive return: Banner's searchResults occasionally returns an envelope with
// `data: null` (session bind race, auth expiry, or success:false). If we spread
// that into an array downstream, `[].push(...null)` throws a cryptic "not
// iterable" error. Coerce nulls to empty arrays here and surface the root cause
// via `success`/empty-data diagnostics one layer up.
export async function searchSections(opts: SearchOptions): Promise<{
  sections: BannerSection[];
  totalCount: number;
  success: boolean;
}> {
  const { term, subject, pageOffset = 0, pageMaxSize = 500 } = opts;
  const params = new URLSearchParams({
    txt_term: term,
    startDatepicker: "",
    endDatepicker: "",
    pageOffset: String(pageOffset),
    pageMaxSize: String(pageMaxSize),
    sortColumn: "subjectDescription",
    sortDirection: "asc",
    _: String(Date.now()),
  });
  if (subject) params.set("txt_subject", subject);

  const result = await getJSON<SearchResultsResponse>(
    `${BASE}/searchResults/searchResults?${params.toString()}`
  );
  // Drop the 50KB ZTC badge before returning — never want it in IndexedDB.
  delete (result as { ztcEncodedImage?: string }).ztcEncodedImage;
  return {
    sections: Array.isArray(result.data) ? result.data : [],
    totalCount: result.totalCount ?? 0,
    success: result.success ?? false,
  };
}

// Fetch ALL sections for a given term by paginating one big term-wide query.
//
// Earlier we looped subject-by-subject with `txt_subject` as a filter, but
// Banner's stateful search silently ignores per-request filters when the
// session has no "committed" criteria — you get the same default page back
// every time. Paginating with ONLY the bound term as criteria is robust.
//
// Session failure mode: if bindTerm silently didn't take effect (auth expired,
// cookies missing, Banner state desync), searchResults returns `success: false`
// and `data: null`. Throw a loud, actionable error instead of silently returning
// zero sections — the user needs to know to re-login.
export async function fetchAllSectionsForTerm(
  term: string,
  onProgress?: (done: number, total: number, label: string) => void
): Promise<BannerSection[]> {
  await resetSession();       // wipe any stale criteria from a prior run
  await bindTerm(term);

  const pageSize = 500;
  const all: BannerSection[] = [];
  let offset = 0;

  while (true) {
    const { sections, totalCount, success } = await searchSections({
      term,
      pageOffset: offset,
      pageMaxSize: pageSize,
    });

    if (!success && offset === 0) {
      throw new Error(
        "Banner searchResults returned success:false. The registration session " +
        "likely expired — open my.fordham.edu → Registration → Browse Classes, " +
        "run one search manually to re-establish the session, then retry."
      );
    }

    all.push(...sections);
    onProgress?.(all.length, totalCount || all.length, `page ${offset / pageSize + 1}`);

    if (sections.length === 0) break;                // empty page → done
    if (totalCount > 0 && all.length >= totalCount) break;
    if (sections.length < pageSize) break;           // partial page → last page

    offset += pageSize;
    await new Promise((r) => setTimeout(r, 150));    // polite breather
  }

  onProgress?.(all.length, all.length, "done");
  return all;
}
