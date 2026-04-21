# DegreeWorks API Reference (Fordham)

> Captured 2026-04-14 from Chrome DevTools Network panel. All endpoints observed
> on a real worksheet load for `worksheets/WEB31`.

## Summary

DegreeWorks is an **Ellucian product**, and the `responsiveDashboard` frontend is
a React SPA that talks to a JSON REST API. The HTML served at
`/responsiveDashboard/worksheets/WEB31` is a **shell only** — the 560KB page we
saved contains no audit data, just the app bundle and an SVG icon sheet. All
real data is fetched client-side from the endpoints below after hydration.

**Consequence:** scraping the DOM is a dead end. We call the API directly from
the extension service worker with `credentials: "include"`, and the user's
existing DegreeWorks session cookies authenticate us automatically — same pattern
as the Banner SSB client.

## Base URL

```
https://dw-prod.ec.fordham.edu/responsiveDashboard/api
```

(The `/about` endpoint lives one level up at `/responsiveDashboard/about`, not
under `/api`. Minor quirk.)

## Authentication

Three cookies are set by the DegreeWorks login flow and ride along on every
request via `credentials: "include"`:

| Cookie | Value |
|--------|-------|
| `X-AUTH-TOKEN` | `Bearer+<JWT>` — signed with HS256, ~1-hour expiry |
| `REFRESH_TOKEN` | `Bearer+<JWT>` — longer-lived, used to mint new access tokens |
| `NAME` | URL-encoded display name |

No custom `Authorization` header is needed — cookies do all the work. If we ever
get 401s, it means the session has expired and the user needs to re-open the
DegreeWorks tab to refresh cookies.

### JWT payload (decoded from `X-AUTH-TOKEN`)

Useful fields — we do **not** need to parse or validate these, but worth knowing
what DegreeWorks embeds:

```jsonc
{
  "sub": "A20000000",           // internal student ID ("banner ID")
  "userClass": "STU",
  "appName": "degreeworks",
  "roles": [                    // server-side permissions
    "CONTACT", "EXTLINKS",
    "SDAUDIT", "SDAUDREV",      // run audits, review
    "SDGPAADV", "SDGPACLC", "SDGPAGRD", "SDGPATRM",  // GPA calculators
    "SDLOKAHD",                 // LOOK-AHEAD: plan future courses ⭐
    "SDSTUME",
    "SDWEB31", "SDWEB33", "SDWEB36",  // worksheet types (WEB31 = student)
    "SDWHATIF",                 // WHAT-IF: alternate major/catalog analysis ⭐
    "SDWORKS",
    "SDXML31", "SDXML33"        // XML export of audits
  ],
  "internalId": "A20000000",
  "name": "Student, Sample A.",
  "exp": <unix timestamp>
}
```

**Two roles are high-value for the project:**
- `SDWHATIF` — hit the What-If endpoint to answer "what if I switched majors?"
- `SDLOKAHD` — Look-Ahead lets us plan courses *not yet taken* into the audit

Both features are things student advisors do manually and are perfect targets
for the AI advisor to automate.

## Endpoint Catalog

### User / session

| Method | Path | Accept | Purpose |
|--------|------|--------|---------|
| GET | `/api/users/myself` | `*/*` | Logged-in user record (identity + permissions, NO school/degree) |
| GET | `/api/students/myself` | `*/*` | Student enrollment record — still unknown, presumed source of `school`/`degree` |
| GET | `/api/messages` | `*/*` | Dashboard messages (70 kB — mostly inert notices) |
| GET | `/api/settings/map` | `*/*` | Feature flags / i18n strings |
| GET | `/about` | **`application/vnd.hedtech.degreeworks.about.v1+json`** ⚠️ | Build/version info |

#### `/api/users/myself` response shape (confirmed 2026-04-14)

```typescript
interface UsersMyself {
  name: string;              // "Student, Sample A." — LastName, FirstName
  id: string;                // "A20000000" (Banner ID)
  userId: string;            // same as `id`
  userClass: "STU" | string; // STU = student
  keys: string[];            // === the JWT `roles` array, duplicated
  lastName: string;          // "LastName"
  firstName: string;         // " FirstName M." — ⚠️ note leading space (Banner artifact)
  username: string | null;   // always null here — auth is cookie-based
  password: string | null;   // always null
  email: string | null;      // null on this endpoint (email lives in auditHeader)
  headerKit: unknown | null;
  modifiedDate: string | null;
}
```

**What's NOT in this response:** `school`, `degree`, `catalogYear`,
`studentLevel`, or anything else needed to construct an `/api/audit` URL.
This endpoint is identity-only. Bootstrapping an audit call therefore requires
one of:

1. **Call `/api/students/myself` first** (shape TBD — the expected source)
2. **Call `/api/audit` with `school=U&degree=BS` hardcoded** for undergrads,
   then read back `degreeInformation.degreeDataArray` for the authoritative
   values on subsequent calls (works but brittle for non-BS degrees)
3. **Parse the JWT `sub` claim** for the student ID — we already have this
   from the cookie, no fetch needed — but JWT has no `school`/`degree` either.

**Recommendation:** always call `/api/students/myself` at boot and cache the
result. If that endpoint turns out to not exist, fall back to strategy 2.

#### `/api/students/myself` response shape (confirmed 2026-04-14) ⭐

The authoritative bootstrap source. Return envelope uses a HATEOAS-style
`_embedded` wrapper — different from the audit endpoint's flat shape.
Ellucian mixed conventions across their own API; our fetch wrapper must
handle both.

```typescript
interface StudentsMyself {
  _embedded: { students: Student[] };
  page: { size: string; totalElements: string; totalPages: string; number: string };
}

interface Student {
  id: string;                     // "A20000000"
  name: string;                   // "Student, Sample A."
  activeTerm: string;             // "202620" — Banner term code (Spring 2026)
  bridgeRefresh: { date: string; time: string };  // last Banner→DW sync
  bridgeChanged: { date: string; time: string };  // last record change
  goals: StudentGoal[];           // one per degree pursued (usually one)
  custom: CustomAttribute[];      // flat key/value bag for school-specific extras
}

interface StudentGoal {
  school: KeyDesc;                // { key: "U", description: "Undergraduate" }
  degree: KeyDesc;                // { key: "BS", description: "Bachelor Of Science" }
  level: KeyDesc;                 // { key: "SR", description: "Senior" }
  catalogYear: KeyDesc;           // { key: "2024", description: "2023-2024" }
  studyPathId: KeyDesc;           // usually empty for undergrad
  details: GoalDetail[];
}

interface GoalDetail {
  code: KeyDesc;                  // key: "COLLEGE" | "PROGRAM" | "CONC" | "MAJOR"
  value: KeyDesc;                 // key: "FC" | "BS-NEUR-FCRH" | "NES" | "NEUR"
}

interface KeyDesc {
  key: string;
  description: string;
}

interface CustomAttribute {
  code: string;                   // see observed codes below
  value: string;
  school?: string;
  degree?: string;
}
```

**Observed `custom` codes:**

| Code | Meaning | Example |
|------|---------|---------|
| `GPACREDITSOV` | GPA credits override (matches `auditHeader.gpaCredits`) | `"96"` |
| `ADVDISP` | Academic advisor display name ⚠️ **ACAD only, not major advisor** | `"Advisor, Sample  A"` |
| `CAMPDESC` | Campus description | `"Rose Hill"` |
| `GRADDATE` | Expected graduation term | `"Spring 2027"` |
| `TRANSFERHRS` | Transfer credit hours | `"0"` |

**⚠️ Parsing gotchas:**

1. The `custom` array has a **trailing empty row** `{ code: "", value: "" }` — fixed-size buffer padding. Filter empties at parse time.
2. Custom values can contain **double-spaces** (`"Advisor, Sample  A"`). Normalize whitespace at the boundary.
3. `goals` is an **array**. Dual-degree students have multiple entries. Don't hardcode `goals[0]`.
4. `activeTerm` uses Banner's six-digit term code. Format confirmed 2026-04-14 by cross-referencing class terms with their literals: `YYYY` is the **academic year ending**, and the suffix is `10` = Fall, `20` = Spring, `30` = Summer, `40` = Winter. So `202420` = Spring 2024, `202610` = Fall 2025, `202620` = Spring 2026, `202710` = Fall 2026. Reuse Banner's term parsing.
5. `ADVDISP` only contains the **academic advisor**. The major advisor is only exposed in `audit.degreeInformation.goalArray` where `attachCode === "MAJR"`. Any "contact your advisor" UI must read both sources.

**Bootstrap sequence for `/api/audit`:**

```typescript
const me = await fetchJSON<StudentsMyself>("/api/students/myself");
const student = me._embedded.students[0];
const goal = student.goals[0];

const params = new URLSearchParams({
  studentId: student.id,
  school: goal.school.key,            // "U"
  degree: goal.degree.key,            // "BS"
  "is-process-new": "false",
  "audit-type": "AA",
  auditId: "",
  "include-inprogress": "true",
  "include-preregistered": "true",
  "aid-term": "",
});

const audit = await fetchJSON<AuditResponse>(
  `/api/audit?${params}`,
  { headers: { Accept: "application/vnd.net.hedtech.degreeworks.dashboard.audit.v1+json" }}
);
```

This is the full bootstrap path. Zero guessing remaining for the read path.

#### `/api/validations/special-entities/course-link-mappings` (confirmed not useful)

Hoped this was a requirement→catalog-query translation table. **It is not.**
It's a per-worksheet-type config for where catalog links point:

```typescript
interface CourseLinkMappings {
  _embedded: {
    courseLinkConfigs: Array<{
      key: string;                // "WEB30" | "WEB31" | "WEB36" | "SEP30" | ...
      version: "S" | string;
      isShowFavoritesOnly: boolean;
      isLinkToSchoolUrl: boolean;
      description: "BSNY" | "DSNY" | "NSNY" | string;  // school-cluster code
    }>;
  };
  _links: { self: { href: string } };
}
```

The `description` field groups worksheet types into three school clusters:

- `BSNY` — Business School (Gabelli)
- `DSNY` — presumed doctoral / graduate program
- `NSNY` — all other programs including FCRH/FCLC undergraduates (our `WEB31` lives here)

`isLinkToSchoolUrl: true` means DegreeWorks resolves catalog references via
the school's external URL rather than a lookup table. **Consequence:** we do
NOT inherit Fordham's own requirement→course mapping logic from this endpoint.
If we want catalog intelligence beyond what's already embedded in `auditHeader`
and the rule tree, we have to build it ourselves (e.g., parse major sheets
from Fordham's bulletin website).

### Validation metadata (static lookup tables)

These return lists used by the UI for dropdowns and labels. Probably worth
caching on first load and never re-fetching.

| Path | Purpose |
|------|---------|
| `/api/validations/special-entities/terms` | Term codes (Fall/Spring/Summer) |
| `/api/validations/special-entities/block-types` | Requirement block categories |
| `/api/validations/special-entities/audit-formats` | Audit layout options |
| `/api/validations/special-entities/audit-freeze-types` | Frozen-audit variants |
| `/api/validations/special-entities/audit-pdf-dimensions` | PDF export sizing |
| `/api/validations/special-entities/course-link-title` | Catalog link templates |
| `/api/validations/special-entities/course-link-sections` | ⭐ Section-search URL template |
| `/api/validations/special-entities/course-link-attributes` | Catalog attribute labels |
| `/api/validations/special-entities/course-link-mappings` | ⭐ Requirement→course mapping rules |

The `course-link-*` endpoints are interesting: DegreeWorks knows how to translate
"this requirement slot" into "this catalog query." If we read those, we inherit
Fordham's own logic for mapping abstract degree rules to concrete course codes,
which saves us from rebuilding that ourselves.

### ⭐ The audit endpoint (the one that matters)

```
GET /api/audit
```

**Required Accept header** (critical — omitting this returns an error):
```
Accept: application/vnd.net.hedtech.degreeworks.dashboard.audit.v1+json
```

Note the weird inconsistency: the audit endpoint uses `vnd.net.hedtech.*` but
`/about` uses `vnd.hedtech.*` (no `net.` prefix). Ellucian vendored two
different media-type specs. Always use `vnd.net.hedtech.*` for the audit.

**Query parameters** (observed values shown):

| Param | Example | Meaning |
|-------|---------|---------|
| `studentId` | `A20000000` | Banner ID — pull from `/api/students/myself` |
| `school` | `U` | College code (`U` = undergraduate) |
| `degree` | `BS` | Degree sought (BS, BA, etc.) |
| `is-process-new` | `false` | Force re-run vs. cached audit |
| `audit-type` | `AA` | `AA` = Academic Audit |
| `auditId` | (empty) | Blank = latest; populate to fetch a specific frozen audit |
| `include-inprogress` | `true` | Count registered courses toward requirements |
| `include-preregistered` | `true` | Count preregistered terms |
| `aid-term` | (empty) | Financial-aid term filter — leave blank |

The endpoint returns **133 kB** of JSON for a typical student.

### ⭐ What-If audits (fully captured 2026-04-14)

**What-If is a POST to the same `/api/audit` path — NOT a GET with query params.**
Response shape is identical to the regular audit, but the request is entirely different:

| Aspect | Regular audit | What-If audit |
|--------|---------------|---------------|
| Method | `GET` | `POST` |
| URL | `/api/audit?studentId=...&school=U&...` | `/api/audit` (no query string) |
| `Accept` header | `application/vnd.net.hedtech.degreeworks.dashboard.audit.v1+json` | `application/json` *(plain!)* |
| `Content-Type` | — | `application/json` |
| Referer (not required but observed) | `/worksheets/WEB31` | `/worksheets/whatif` |

**Request body (confirmed live):**

```json
{
  "studentId": "A20000000",
  "isIncludeInprogress": true,
  "isIncludePreregistered": true,
  "isKeepCurriculum": false,
  "school": "U",
  "degree": "BS",
  "catalogYear": "2024",
  "goals": [
    { "code": "MAJOR",   "value": "PSYC", "catalogYear": "" },
    { "code": "COLLEGE", "value": "FC",   "catalogYear": "" }
  ],
  "classes": []
}
```

**Field notes:**

- `studentId` — Banner ID. **Never log or commit the request body**, it contains PII.
- `isIncludeInprogress` / `isIncludePreregistered` — mirror the GET query flags. Almost always `true`.
- `isKeepCurriculum` — when `false`, the server throws away the student's real
  curriculum (major/minor/college/degree) and uses only the `goals` array. When
  `true`, it overlays the goals on top of the existing curriculum — useful for
  "add a minor" style what-ifs. We haven't tested this mode yet.
- `school` / `degree` / `catalogYear` — base curriculum the goals attach to.
  The `catalogYear` here is a **string** like `"2024"` (the entry year).
- `goals` — declarative curriculum overrides. Each goal is `{ code, value, catalogYear }`.
  - `code` values observed: `"MAJOR"`, `"COLLEGE"`
  - `code` values likely available (based on DegreeWorks data model): `"MINOR"`, `"CONCENTRATION"`, `"DEGREE"`, `"PROGRAM"`, `"LIBARTS"`
  - Per-goal `catalogYear` empty string means "inherit the top-level `catalogYear`"
- `classes` — **this is the Look-Ahead hook**. Empty on a pure What-If. Populating
  it with `[{ discipline: "CISC", number: "3810" }, ...]` is the presumed Look-Ahead
  request shape (confirmation pending a live capture — see below).

**Observed response markers** (tested by switching Neuroscience → Psychology):

- `auditHeader.whatIf: "Y"` (vs. `"N"` for a real audit)
- `auditHeader.auditType: "AA"` (unchanged — still "Academic Audit")
- `blockArray[0]` is still the degree block (`RA000115`) but with a different
  major requirement wired underneath. The Psychology major block
  (`RA001495`) appears instead of the student's real major block.
- `classInformation`, `fitList`, `exceptionList` — all populated with the student's
  real course history, re-fit against the hypothetical requirements. This is
  exactly what we want: "if I switched today, how far along would I be?"

**Client implementation sketch** (goes in `degreeworks-api-client.ts`):

```typescript
async function fetchWhatIfAudit(
  studentId: string,
  goals: { code: "MAJOR" | "MINOR" | "COLLEGE" | "CONCENTRATION" | "DEGREE"; value: string; catalogYear?: string }[],
  opts: { school?: string; degree?: string; catalogYear?: string; classes?: { discipline: string; number: string }[] } = {}
): Promise<AuditResponse> {
  const res = await fetch("https://dw-prod.ec.fordham.edu/responsiveDashboard/api/audit", {
    method: "POST",
    credentials: "include",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      studentId,
      isIncludeInprogress: true,
      isIncludePreregistered: true,
      isKeepCurriculum: false,
      school: opts.school ?? "U",
      degree: opts.degree ?? "BS",
      catalogYear: opts.catalogYear ?? "2024",
      goals: goals.map(g => ({ code: g.code, value: g.value, catalogYear: g.catalogYear ?? "" })),
      classes: opts.classes ?? [],
    }),
  });
  if (!res.ok) throw new Error(`What-If audit failed: ${res.status}`);
  return res.json();
}
```

Note: `credentials: "include"` is critical — the `X-AUTH-TOKEN`, `REFRESH_TOKEN`,
and `NAME` cookies must be sent for the server to authenticate the request.

### ⭐ Look-Ahead audits (SDLOKAHD role — endpoint inferred, body TBD)

Look-Ahead is the "add this course I haven't taken yet and recompute" feature.
The `SDLOKAHD` role in the JWT confirms it's available to this user.

**Strong hypothesis (unconfirmed):** Look-Ahead reuses the **same POST `/api/audit`**
as What-If, but populates the `classes` array in the body with hypothetical
courses instead of leaving it empty. Likely body shape:

```json
{
  "studentId": "A20000000",
  "isIncludeInprogress": true,
  "isIncludePreregistered": true,
  "isKeepCurriculum": true,
  "school": "U",
  "degree": "BS",
  "catalogYear": "2024",
  "goals": [],
  "classes": [
    { "discipline": "CISC", "number": "3810" },
    { "discipline": "CISC", "number": "4090" }
  ]
}
```

Key differences from What-If:
- `isKeepCurriculum: true` (keep real major/minor, just overlay hypothetical courses)
- `goals: []` (no major swap)
- `classes: [...]` populated

The Referer may also differ (`/worksheets/lookahead` instead of `/worksheets/whatif`)
but the server shouldn't care about that.

**TODO:** capture a live Look-Ahead request — DevTools → Network tab →
click "Look Ahead" tab in DegreeWorks → add a course you haven't taken →
click Process New → copy cURL → paste here. Confirms/corrects the above.

## Audit Response Shape

Top-level structure (confirmed from live response):

```typescript
interface AuditResponse {
  auditHeader: AuditHeader;
  blockArray: AuditBlock[];          // the requirement tree
  classInformation: ClassInformation; // full course history w/ fit locations
  fallThrough: ClassBucket;           // electives that didn't fit any requirement
  overTheLimit: ClassBucket;          // classes over a MAX cap
  insufficient: InsufficientBucket;   // failed/withdrawn classes
  inProgress: ClassBucket;            // currently-enrolled + preregistered
  fitList: FitList;                   // DW's fit-assignment decision trace
  splitCredits: { classes: string; credits: string };
  degreeInformation: DegreeInformation; // degree-level metadata + advisors
  exceptionList: ExceptionList;       // advisor overrides
  notes: Record<string, unknown>;     // advisor notes (usually empty)
  flags: Record<string, string>;      // Ellucian internal config (opaque)
}

interface AuditHeader {
  auditId: string;              // "AK09qG1P"
  studentId: string;            // "A20000000"
  auditType: string;            // "AA"
  studentName: string;          // "Student, Sample A."
  studentEmail: string;         // "student@fordham.edu"
  freezeType: string;
  freezeTypeDescription: string;
  freezeDate: string;
  freezeUserName: string;
  auditDescription: string;
  dateYear: string;             // "2026"
  dateMonth: string;            // "04"
  dateDay: string;              // "09"
  timeHour: string;
  timeMinute: string;
  studentSystemGpa: string;     // "3.424" (string, not number!)
  degreeworksGpa: string;       // "3.424"
  percentComplete: string;      // "85"
  version: string;              // "$Id$ OS_TYPE=Linux; Release=5.1.6.2"
  inProgress: "Y" | "N";
  whatIf: "Y" | "N";
  residentApplied: string;
  residentAppliedInProgress: string;
  transferApplied: string;
  examAppliedCredits: string;
  residentOverTheLimit: string;
  residentOverTheLimitInProgress: string;
  transferOverTheLimit: string;
  examOverTheLimit: string;
}

interface AuditBlock {
  requirementId: string;          // "RA000115"
  requirementType: string;        // "DEGREE" | "MAJOR" | "MINOR" | "CORE" | ...
  requirementValue: string;       // "BS" | major code | ...
  title: string;                  // "Degree in Bachelor of Science-FC"
  percentComplete: string;        // "85"
  catalogYearStart: string;       // "2005"
  catalogYearStop: string;        // "9999"
  catalogYear: string;            // "2024"
  catalogYearLit: string;         // "2023-2024" (human-readable)
  degree: string;                 // "BS"
  college: string;                // "FC" (Fordham College Rose Hill)
  gpa: string;                    // "3.424"
  classesApplied: string;         // "43"
  creditsApplied: string;         // "131"
  gpaGradePoints: string;         // "328.709991"
  gpaCredits: string;             // "96"
  header: BlockHeader;
  ruleArray: AuditRule[];
}

interface BlockHeader {
  qualifierArray: Qualifier[];    // MINCLASS, MINCREDIT, MINRES, etc.
  remark: { textList: string[] }; // freeform admin notes
  display: { textArray: Array<{ lineList: string[] }> };  // pre-rendered status lines
  advice: {
    textArray: Array<{
      nodeId: string;             // links advice to the qualifier it describes
      lineList: string[];         // "You need 3 more 3+ credit classes."
    }>;
  };
}

interface Qualifier {
  nodeId: string;
  nodeType: string;               // "4101" = MAXCLASS, "4102" = MINCLASS, etc.
  satisfied?: "Yes" | "No" | "Inprogress";
  applied?: string;
  needed?: string;
  name: string;                   // "MINRES" | "MINCLASS" | "CLASSESCREDITS" | ...
  classes?: string;
  credits?: string;
  label?: string;                 // human label, e.g. "Number of Credits Required for Graduation"
  labelTag?: string;              // short tag, e.g. "124CRED"
  text: string;                   // one-line rendered summary
  subTextList?: string[];         // wrapped continuation of `text`
  code?: string;                  // for HEADERTAG: "RemarkJump" etc.
  value?: string;                 // for HEADERTAG: the target URL/anchor
}

interface AuditRule {
  label: string;                  // "2.0 GPA Requirement Met"
  labelTag: string;               // short code
  percentComplete: string;
  ruleId: string;                 // "1-0" — dotted path inside the block
  nodeId: string;                 // "46"
  nodeType: string;               // see rule nodeType enum below
  indentLevel: string;            // "1" | "2" | "3" — nesting depth
  ruleType: "Complete" | "Block" | "Blocktype" | "Course" | "Group";
  ifElsePart?: "IfPart" | "ElsePart";    // conditional branches (catalog-year logic)
  inProgressIncomplete?: "Yes";          // rule not satisfied but has enrolled classes
  subruleIncomplete?: "Yes";             // at least one descendant rule is incomplete
  lastRuleInGroup?: "Yes";               // final rule inside a Group — closes the group
  remark?: { textList: string[] };
  classesApplied?: string;               // count of classes applied to this rule
  creditsApplied?: string;               // sum of credits applied
  classesAppliedToRule?: ClassesAppliedToRule;
  requirement: Requirement;
  advice?: RuleAdvice;
  ruleArray?: AuditRule[];               // nested subrules (Group / Blocktype containers)
}

// Rule nodeType enum (confirmed from audit + what-if responses)
// 4200 — Course rule      (a concrete course-slot requirement)
// 4400 — Block rule       (pulls in another block by type+value, e.g. CORE, PREHEALTH)
// 4500 — Blocktype rule   (pulls in a block by type alone, e.g. any MAJOR — used by What-If)
// 4600 — Group rule       (selects N of M subrules, with its own nested ruleArray)
// 4900 — Complete rule    (already-satisfied gate like "2.0 GPA Requirement Met")

interface ClassesAppliedToRule {
  classArray?: Array<{
    discipline: string;           // "ENGL"
    number: string;               // "1102"
    credits: string;              // "3"
    letterGrade: string;          // "A", "A-", "B+", "" (in-progress), "TB" (transfer B)
    id: string;                   // class record id (matches classInformation.classArray[].id)
    term: string;                 // Banner term code, e.g. "202410"
  }>;
  // Empty object `{}` when no classes applied (e.g. an unmet Course rule).
}

interface Requirement {
  // Count targets: which of the two is set depends on classCreditOperator
  classesBegin?: string;          // "1" — need at least N classes
  creditsBegin?: string;          // "12" — need at least N credits
  classCreditOperator: "OR" | "AND";
  connector: "," | "AND" | "";    // how courseArray entries join

  // Tiebreaker: how DegreeWorks picks one course when multiple are eligible.
  // "LOWTERM" = prefer the earliest term. Observed; other values likely exist.
  decide?: "LOWTERM" | string;

  // The list of courses that can satisfy this rule.
  courseArray: CourseMatcher[];

  // Courses explicitly excluded from the match above.
  except?: { courseArray: CourseMatcher[] };

  // Local qualifiers on this specific rule (ShareWith, HighPriority, etc.)
  qualifierArray?: Qualifier[];

  // Block / Blocktype rule fields (used when ruleType = "Block" or "Blocktype"):
  numBlocks?: string;             // "1"
  numBlocktypes?: string;         // "1" (Blocktype variant)
  type?: string;                  // "OTHER" | "MAJOR" | "MINOR" | "CORE" — block category
  value?: string;                 // "CORE" | "PREHEALTH" — specific block key (Block only)

  // Group rule fields (used when ruleType = "Group"):
  numberOfGroups?: string;        // "1" — how many subrule groups must be satisfied
  numberOfRules?: string;         // "3" — how many subrules per group
}

interface CourseMatcher {
  discipline: string;             // "ENGL" | "@" (wildcard = any discipline)
  number: string;                 // "1102" | "@" (wildcard = any number)
  numberEnd?: string;             // "4995" — upper bound for number range matches
  nodeId: string;
  newDiscipline?: "Yes";          // first entry of a new discipline in the list
  hideFromAdvice?: "Yes";         // valid match but don't show in "you need X" suggestions
  withArray?: WithClause[];       // constraints applied to the matcher
}

interface WithClause {
  code: "ATTRIBUTE" | "DWCREDITS" | "DWTERM" | "DWPASSFAIL" | "DWSCHOOL" | "DWINPROGRESS" | string;
  operator: "=" | ">=" | "<=" | "<>" | ">";
  connector: "" | "AND" | "OR";   // how this clause joins the next one
  valueList: string[];            // "[\"PYBP\"]" or "[\"3\"]" — always a list even for scalar
}

// Example: "ATTRIBUTE = PYBP AND DWCREDITS >= 3" becomes
//   [
//     { code: "ATTRIBUTE",  operator: "=",  connector: "AND", valueList: ["PYBP"] },
//     { code: "DWCREDITS",  operator: ">=", connector: "AND", valueList: ["3"] },
//   ]

interface RuleAdvice {
  // Used for incomplete rules to suggest what to take next.
  classes?: string;               // target count, e.g. "1"
  connector?: string;             // ", "
  courseArray?: Array<CourseMatcher & {
    title?: string;               // "Research Methods Lab"
    credits?: string;             // "5"
    prerequisiteExists?: "Y" | "N";
    withAdvice?: string;          // human-readable "ATTRIBUTE = PYBP" — pre-rendered
  }>;
  except?: { courseArray: CourseMatcher[] };

  // Used on Blocktype rules ("Major Requirements" etc.) to name candidate blocks:
  titleList?: string[];           // ["Major in Psychology", "Major in Computer Science"]

  // Used when advice points at a specific block that needs to be satisfied:
  blockId?: string;               // "RA000554" — the Core Curriculum block
}
```

### Qualifier types — dispatch on `.name`, not on numeric `nodeType`

**Important design note (resolved 2026-04-14).** Every `Qualifier` object carries
both a numeric `nodeType` (e.g. `"4101"`) AND a symbolic `name` (e.g. `"MAXCLASS"`).
The parser should switch on `.name` — it's the stable, human-readable API, and
it's present on every qualifier observed so far. The numeric `nodeType` is
Ellucian internal machinery and is only useful for decoding raw response dumps
when debugging. **Don't dispatch on the integer.** This removes the need to
maintain a complete `4100–4999` enum.

Same principle applies to rules: `AuditRule.ruleType` is the authoritative
string (`"Complete" | "Block" | "Blocktype" | "Course" | "Group"`). The numeric
`AuditRule.nodeType` mirrors it and is secondary.

#### Symbolic qualifier names (Ellucian Scribe keyword reference)

These are the qualifier names the Scribe rule language emits into the runtime
audit. Confirmed ones have live examples from captured Fordham audits; expected
ones are documented by Ellucian's Scribe language but not yet observed in a
Fordham response — still safe to switch on, just mark the branch as `TODO:
verify shape`.

| `name` | Status | Shape hint | Meaning |
| --- | --- | --- | --- |
| `MAXCLASS` / `MAXCLASSES` | ✅ confirmed | `{ classes, text, subTextList, tag? }` | Cap on # of classes matching a selector |
| `MINCLASS` / `MINCLASSES` | ✅ confirmed | `{ classes, text, subTextList, satisfied?, applied?, needed? }` | Floor on # of classes |
| `MAXCREDIT` / `MAXCREDITS` | ✅ confirmed | `{ credits, text, subTextList }` | Cap on # of credits matching a selector |
| `MINCREDIT` / `MINCREDITS` | ⏳ expected | `{ credits, ... }` | Floor on # of credits |
| `MINGPA` | ✅ confirmed | `{ minGPA, label, labelTag, satisfied, applied }` | Minimum GPA gate |
| `MAXGPA` | ⏳ expected (rare) | `{ maxGPA, ... }` | Maximum GPA (unusual) |
| `MINGRADE` | ✅ confirmed | `{ minGrade, text }` | Minimum numeric grade per course (`"1.67"` = C-) |
| `MINRES` | ✅ confirmed | `{ credits, text, satisfied, applied }` | Residency credits minimum |
| `MINRESIDENCECLASSES` | ⏳ expected | `{ classes, ... }` | Residency classes minimum |
| `MINRESIDENCECREDITS` | ⏳ expected (alias for MINRES) | `{ credits, ... }` | Residency credits minimum (verbose form) |
| `MAXPASSFAIL` | ⏳ expected | `{ classes?, credits?, text }` | Cap on pass/fail usage |
| `MAXTRANSFER` | ⏳ expected | `{ classes?, credits?, text }` | Cap on transfer-in usage |
| `MAXPERDISC` | ⏳ expected | `{ classes?, credits?, discipline }` | Max classes/credits per discipline |
| `MINPERDISC` | ⏳ expected | `{ classes?, credits?, discipline }` | Min classes/credits per discipline |
| `MINSPREAD` | ⏳ expected | `{ disciplines, text }` | Minimum # of distinct disciplines |
| `NONEXCLUSIVE` | ✅ confirmed | `{ text: "ShareWith ", subTextList }` | Rule may share classes with another block/rule (e.g. `(CORE)`, `(MAJOR)`, `(THISBLOCK)`) |
| `EXCLUSIVE` | ⏳ expected | `{ text }` | Rule cannot share classes with others |
| `SHARE` | ⏳ expected | `{ text, subTextList }` | Explicit share-with partner list |
| `DONTSHARE` | ⏳ expected | `{ text, subTextList }` | Explicit no-share partner list |
| `CLASSESCREDITS` | ✅ confirmed | `{ credits, classesApplied, creditsApplied, label, satisfied }` | Classes-or-credits counter for a requirement |
| `HIGHPRIORITY` | ✅ confirmed | `{ text: "HighPriority" }` | Fit-order hint: before default |
| `LOWPRIORITY` | ✅ confirmed | `{ text: "LowPriority" }` | Fit-order hint: after default |
| `LOWESTPRIORITY` | ✅ confirmed | `{ text: "LowestPriority" }` | Fit-order hint: last |
| `HIDE` | ⏳ expected | `{ ... }` | Suppress this block from display (still evaluated) |
| `HIDERULE` | ⏳ expected | `{ ... }` | Suppress this rule from display |
| `HEADERTAG` | ✅ confirmed | `{ code, value }` | Block metadata key-value (e.g. `RemarkJump` = help URL anchor) |

**Numeric nodeType quick-reference (confirmed only, for debug dumps):**

`4101` MAXCLASS · `4102` MINCLASS · `4103` MAXCREDIT · `4111` NONEXCLUSIVE ·
`4116` MINGPA · `4117` MINGRADE · `4119` MINRES · `4121` CLASSESCREDITS ·
`4135` HIGHPRIORITY · `4136` LOWPRIORITY · `4141` LOWESTPRIORITY · `4142` HEADERTAG.

Any qualifier whose `nodeType` falls in `4100–4199` and is not in this list is
safely parseable by switching on `.name` — you don't need the numeric code.

**Observed `tag` values on MAXCLASS qualifiers** (Banner-side grading-policy keys):
`NoPFCOVID`, `NoPFExceptCOVIDPF`, `Only1Learning`, `Only1Cognition`, `Only1SocPsych`.
These gate specific course-repeat rules; parser can treat them as opaque strings.

## Complete Response Shape (discovered 2026-04-14)

The audit response has **thirteen** top-level keys, not just two. Here are
interfaces for the ten beyond `auditHeader` and `blockArray`. All numeric fields
are string-encoded like the rest of the response.

### `classInformation` — full course history

```typescript
interface ClassInformation {
  classArray: TakenClass[];
}

interface TakenClass {
  discipline: string;             // "CISC"
  number: string;                 // "2010"
  credits: string;                // "4.0"
  letterGrade: string;            // "A" | "A-" | "W" | "F" | "" (in-progress)
  id: string;                     // internal class ID
  term: string;                   // "202510" (Banner term code)
  courseTitle: string;
  termLiteral: string;            // "Fall 2024"
  termLiteralLong: string;        // "Fall 2024 (Regular Academic Session)"
  recordType: string;             // "Course" | "Transfer" | ...
  status: string;                 // "A" | "R" | "W" | ...
  studentSystemCredits: string;
  inProgress: "Y" | "N";
  preregistered: "Y" | "N";
  passed: "Y" | "N";
  passfail: "Y" | "N";
  incomplete: "Y" | "N";
  atCode?: string;                // attendance / grading mode
  gradePoints: string;            // "16.0"
  numericGrade: string;           // "4.0"
  gpaGradePoints: string;
  gpaCredits: string;
  section: string;                // "L01"
  school: string;                 // "U"
  gradeType: string;
  repeatDiscipline?: string;
  repeatNumber?: string;
  repeatPolicy?: string;
  transfer: "Y" | "N";
  transferCode?: string;
  transferType?: string;
  partTerm?: string;
  equivalenceExists: "Y" | "N";
  locArray: ClassLocation[];      // where this class fits in the audit tree
  attributeArray: ClassAttribute[];
}

interface ClassLocation {
  requirementId: string;          // links to AuditBlock.requirementId
  nodeLocation: string;           // path within the rule tree
  level: string;
  headerFit: "Y" | "N";
  qualifierNodeLocation?: string;
  rank: string;                   // priority tier for fit resolution
  reasonRemoved?: string;         // why the class was NOT applied here
  inGroup: "Y" | "N";
}

interface ClassAttribute {
  DWSISKEY: string;               // DegreeWorks internal key
  ATTRIBUTE: string;              // Fordham core code (see taxonomy below)
}
```

**Observed Fordham `ATTRIBUTE` codes** (incomplete — taxonomy still unknown):

*Core curriculum slots (from audit requirement trees):*
- `MCR` — Math/Computational Reasoning
- `FACC` — Fine Arts (Core)
- `HC` — Understanding Historical Change
- `SSCI` — Social Science (Core)
- `STXT` — Sacred Texts and Traditions
- `ALC` — Advanced Literature Course
- `ASSC` — Advanced Social Science Course
- `ICC` — Interdisciplinary Capstone Core
- `EP1`, `EP2`, `EP3`, `EP4` — Eloquentia Perfecta 1/2/3/4 (writing-intensive tiers)
- `GLBL` — Global Studies
- `PLUR` — American Pluralism
- `MANR` — Math and Reasoning (legacy fallback, e.g. MATH 1003)

*Psychology major attributes:*
- `PYBP` — Psychology Basic Process course
- `PYCP` — Psychology Complex Process course
- `PYAC` — Psychology Advanced course
- `PYCA` — Psychology Capstone
- `PYCL` — Psychology Content Laboratory
- `PSDV` — Psychology Diversity requirement
- `PSYC` — General Psychology elective attribute

*Other observed (source unclear — seen on classes in `classInformation`):*
`FCRH`, `NEUR`, `ZLB1`, `ZLB3`, `HHPA`, `HUST`, `REST`, `COLI`, `GERM`, `SL`,
`ACUP`, `ASAM`, `ASHS`, `FRFA`, `LAHA`, `LALS`, `FRPT`, `ENVS`, `BESN`, `LING`,
`ADVD`, `AMCS`, `AMST`, `APPI`, `ASRP`, `BEVL`, `BIOE`, `LPHP`, `VAL`, `INST`,
`ISME`, `JSTH`, `JWST`, `MEST`, `MVST`, `MVTH`, `OCST`, `STSN`, `THHC`, `IPE`,
`ENST`, `ESNS`, `ESPS`, `ESLS`.

**Reverse-mapping is now possible** without scraping: every Course rule in
`blockArray[].ruleArray[]` with a `withArray[]` clause of
`{ code: "ATTRIBUTE", operator: "=", valueList: [X] }` proves that attribute
`X` satisfies the rule's `label`. Walking the rule tree gives us an
authoritative `ATTRIBUTE → requirement slot` map from the audit itself.

### `fallThrough`, `overTheLimit`, `inProgress` — class buckets

```typescript
interface ClassBucket {
  classes: string;                // count, e.g. "12"
  credits: string;                // "31"
  noncourses?: string;            // only on fallThrough
  classArray: TakenClass[];       // same shape as classInformation
}
```

- **`fallThrough`** — classes completed but didn't satisfy any requirement slot.
  These are overflow electives. Example (scrubbed): dropped pre-med chem
  sequence + assorted one-off electives.
- **`overTheLimit`** — classes beyond a MAX cap (e.g. ZZRU ADVI excess).
- **`inProgress`** — currently-enrolled + preregistered classes. Mirrors the
  live registration state; use this to answer "what am I taking right now?"

### `insufficient` — failed / withdrawn history

```typescript
interface InsufficientBucket {
  classes: string;
  credits: string;
  classArray: InsufficientClass[];
}

interface InsufficientClass extends TakenClass {
  reasonInsufficient: "FA" | "WD" | string;  // FA=failed, WD=withdrawn
  forceInsufficient?: "Y" | "N";             // advisor-forced removal
}
```

Preserves academic transition history. Valuable context for an advisor bot:
e.g., a dropped pre-med path is visible without asking the student.

### `fitList` — DegreeWorks' fit-assignment decision trace

```typescript
interface FitList {
  classArray: FitClass[];
}

interface FitClass {
  discipline: string;
  number: string;
  term: string;
  // ... same class identity fields as TakenClass ...
  rank: string;
  rankReason: string;             // human-readable explanation
}
```

**Observed `rankReason` values** (this is an informal enum, not a closed set):

- `"this fit is a must-take-fit"`
- `"this fit has a higher priority: 5 vs 0"`
- `"first (only?) location"`
- `"This was the last valid fit; all others were removed"`
- `"these two fits are equal"`

**Why this matters:** DegreeWorks exposes *why* each class counts where it does.
We can surface this to the student as "CISC 2010 is counting toward Major Core
because it has higher priority there (5) than as a general elective (0)" —
something the native worksheet UI doesn't show clearly.

### `splitCredits`

```typescript
interface SplitCredits {
  classes: string;                // "0" for Patch
  credits: string;                // "0"
}
```

Tracks classes whose credits are split across multiple requirement slots.
Often zero. `classArray` only appears when non-empty.

### `degreeInformation` — degree metadata + advisors ⭐

```typescript
interface DegreeInformation {
  degreeDataArray: DegreeData[];
  goalArray: Goal[];
}

interface DegreeData {
  degree: string;                 // "BS"
  school: string;                 // "U"
  catalogYear: string;            // "2024"
  activeTerm: string;             // "202610" (Fall 2025)
  studentLevel: string;           // "UG"
  degreeTerm: string;             // expected graduation term
  studentSystemCumulativeGradedCreditsAttempted: string;
  studentSystemCumulativeGradePointsEarned: string;
  studentSystemCumulativeGpa: string;
  studentSystemCumulativeTotalCreditsEarned: string;
  studentSystemCumulativeCreditsEarned: string;
  degreeSource: string;
  degreeLiteral: string;          // "Bachelor of Science"
  schoolLiteral: string;          // "Undergraduate"
  studentLevelLiteral: string;    // "Undergraduate"
  catalogYearLit: string;         // "2023-2024"
  activeTermLiteral: string;      // "Fall 2025"
}

interface Goal {
  code: "COLLEGE" | "CONC" | "MAJOR" | "PROGRAM" | "ADVISOR";
  value: string;                  // e.g. "NEUR" for MAJOR
  valueLiteral: string;           // "Integrative Neuroscience"
  catalogYear?: string;
  // Only on ADVISOR goals:
  attachCode?: "ACAD" | "MAJR";   // Academic advisor vs. Major advisor
  attachValue?: string;
  advisorName?: string;
  advisorEmail?: string;
}
```

**`goalArray` is the only place the advisor split is exposed.** A student has
up to two advisors:
- `attachCode: "ACAD"` — assigned academic advisor (general)
- `attachCode: "MAJR"` — major-department advisor (subject expert)

Advisor-routing features (e.g. "who do I email about this?") depend entirely
on this structure.

### `exceptionList` — advisor overrides

```typescript
interface ExceptionList {
  exceptionArray: Exception[];
}

interface Exception {
  id: string;
  type: string;
  label: string;                  // "PSYC 2000 = CISC 2850 per Finnemann"
  requirementId: string;          // which block the exception targets
  nodeType: string;
  enforced: "Yes" | "No";
  reason: string;
  remark: string;
  applyStatus: "AP" | "UN" | string;  // AP=applied, UN=unhooked (requirements changed)
  labelTag: string;
  school: string;
  degree: string;
  date: string;                   // YYYYMMDD
  who: string;                    // advisor username
  whoEmail: string;
}
```

`applyStatus: "UN"` with `enforced: "No"` means the exception was authored but
the underlying requirement changed, so DegreeWorks stopped honoring it. Good
signal for advisor bots: "this override is stale, may need renewal."

### `notes` and `flags`

```typescript
interface Notes {
  // Usually empty. Populated by advisors via the native UI.
  [key: string]: unknown;
}

interface Flags {
  cfg020DAP14?: string;           // opaque Ellucian internal config
  cfg020TIEBREAK?: string;
  [key: string]: string | undefined;
}
```

Ignore `flags` unless we find a need. Not student-facing.

### Example data (synthetic, for testing)

```jsonc
{
  "auditHeader": {
    "auditId": "AK09qG1P",
    "studentId": "A20000000",
    "studentName": "Student, Sample A.",
    "studentSystemGpa": "3.424",
    "percentComplete": "85",
    "dateYear": "2026", "dateMonth": "04", "dateDay": "09",
    "inProgress": "Y"
  },
  "blockArray": [
    {
      "requirementId": "RA000115",
      "requirementType": "DEGREE",
      "requirementValue": "BS",
      "title": "Degree in Bachelor of Science-FC",
      "catalogYear": "2024",
      "catalogYearLit": "2023-2024",
      "gpa": "3.424",
      "classesApplied": "43",
      "creditsApplied": "131"
    }
    // + a "PREHEALTH" block observed in ruleArray
  ]
}
```

## Known Unknowns (still need to verify)

Both read and write paths are now **fully specified** — bootstrap + audit
(GET) + What-If audit (POST) can all be implemented without further discovery.
Only one unknown remains and it's a lazy fill, not a blocker.

1. **Look-Ahead request body** — Endpoint confirmed to be the same `POST /api/audit`
   as What-If (strong hypothesis; see Look-Ahead section). The exact body shape
   for populating `classes: []` with hypothetical courses is unconfirmed but
   almost certainly `{ discipline, number }` entries. Worth one capture to
   verify, but does not block implementation — we can guess and test.

### Resolved ✅

- ~~`/api/students/myself` response shape~~ — confirmed 2026-04-14, documented
- ~~`/api/validations/special-entities/course-link-mappings`~~ — confirmed not useful
- ~~Top-level audit keys past `blockArray`~~ — all 13 keys documented
- ~~What-If endpoint shape~~ — **fully captured 2026-04-14.** `POST /api/audit` with JSON body `{ studentId, school, degree, catalogYear, goals: [{code, value, catalogYear}], classes: [], isKeepCurriculum, isIncludeInprogress, isIncludePreregistered }`. Plain `application/json` Accept header (NOT the vendor media type the GET uses).
- ~~Fordham `ATTRIBUTE` taxonomy strategy~~ — resolved via reverse-mapping: each Course rule's `withArray` clause proves which requirement an attribute satisfies. No external scraping needed.
- ~~Banner term code format~~ — `YYYY + 10/20/30/40 = Fall/Spring/Summer/Winter`, `YYYY` = academic year ending. Confirmed by cross-referencing class terms with term literals.
- ~~`AuditRule.requirement` grammar~~ — full courseArray/withArray/except/decide/classesBegin/creditsBegin structure documented
- ~~Complete numeric `nodeType` enum~~ — **reframed 2026-04-14**: not actually needed. Every qualifier has a symbolic `name` field and every rule has a string `ruleType` field; parser dispatches on those and ignores the numeric code entirely. Scribe keyword reference documented in the Qualifier section above.

## PII Handling

Every request and response contains the student's Banner ID (`A20000000`) and
full name. When logging or broadcasting events from the service worker:

- **Never** log the full JWT. If we ever log auth debug info, log only `exp` and
  the first 8 chars of the `jti`.
- **Never** log the audit response body. If we need a debug dump, redact
  `auditHeader.studentId`, `studentName`, `studentEmail` first.
- **Never** commit sample responses with real student data to git. If we need a
  test fixture, scrub PII and check in a redacted version under
  `notes/fixtures/audit-redacted.json`.

## Strategy Recommendation

Replace the existing `degreeworks-content.ts` HTML parser with a
`degreeworks-api-client.ts` module that mirrors `banner-ssb-client.ts`:

- Lives in the service worker (no content script needed for data fetching)
- Content script becomes ~10 lines: detect DegreeWorks tab → tell service worker
  to refresh audit → service worker makes the API call with the tab's cookies
- Auth survives as long as the user has visited DegreeWorks in the last hour
- If auth expires, we show a banner: "Open DegreeWorks to refresh your audit"
  and the user clicks once

This is strictly better than the current scraping approach on every axis:
correctness, resilience, performance, and completeness.
