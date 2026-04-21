// Backing logic for the `search_catalog` tool exposed to Claude.
//
// Queries the IndexedDB course catalog (populated by banner-ssb-client) and
// returns a compact, token-frugal shape — courses are capped, sections within
// each course are capped, and meetings are flattened to single-line strings.
// The goal: enough signal for Claude to recommend real CRNs, small enough
// that a single tool-use round-trip doesn't eat the context budget.

import {
  getAllCourses,
  getCoursesBySubject,
  getCourse,
} from "../../shared/db";
import type { Course, Section, Day } from "../../shared/types";

export interface CatalogSearchInput {
  subject?: string;
  course_code?: string;
  min_number?: number;
  max_number?: number;
  keyword?: string;
  days?: Day[];
  has_seats?: boolean;
  attributes?: string[];  // AND-intersected against section attribute codes/descriptions
  limit?: number;
}

// Compact section shape — single strings instead of nested meeting objects.
export interface CatalogSearchSection {
  crn: string;
  instructor: string;
  seats: number;
  campus: string;
  mode: string;
  meetings: string[];  // e.g. ["MWF 14:00-15:15 @ Keating 206"]
  attributes: string[];  // e.g. ["AMER","ICC"] — codes only, cross-reference with list_attributes
}

export interface CatalogSearchResult {
  courseCode: string;
  title: string;
  credits: number;
  totalSections: number;
  sections: CatalogSearchSection[];
}

function parseCourseNumber(courseCode: string): number {
  const match = courseCode.match(/\d{3,4}/);
  return match ? parseInt(match[0], 10) : 0;
}

function compactSection(s: Section): CatalogSearchSection {
  const meetings = s.meetings.map((m) => {
    const days = m.days.join("");
    const time = m.startTime && m.endTime ? `${m.startTime}-${m.endTime}` : "async";
    const loc = [m.building, m.room].filter(Boolean).join(" ").trim();
    return loc ? `${days} ${time} @ ${loc}` : `${days} ${time}`;
  });
  return {
    crn: s.crn,
    instructor: s.instructor,
    seats: s.seatsAvailable,
    campus: s.campus,
    mode: s.deliveryMode,
    meetings: meetings.length > 0 ? meetings : ["async / TBA"],
    attributes: (s.attributes ?? []).map((a) => a.code),
  };
}

// Match a requested attribute against a section's attribute list. Case-insensitive.
// Matches if the query equals a code OR is a substring of any description.
// This lets Claude pass either "AMER" or "American Pluralism" and both work.
function sectionHasAttribute(section: Section, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const attrs = section.attributes ?? [];
  return attrs.some(
    (a) => a.code.toLowerCase() === q || a.description.toLowerCase().includes(q)
  );
}

// Distinguishes "catalog not loaded" from "query returned no matches" so the
// model can tell the student to refresh the catalog vs. re-try a different
// search. Previously both cases returned [] and Sonnet would say "no courses
// available" — misleading when the real cause was an un-refreshed catalog.
async function ensureCatalogLoaded(): Promise<void> {
  const all = await getAllCourses();
  if (all.length === 0) {
    throw new Error(
      "Catalog not loaded. Ask the student to open Settings → Course Catalog, " +
      "select a term (typically Fall or Spring), and click Refresh. The refresh " +
      "takes ~30-60 seconds and only needs to be done once per term. After the " +
      "refresh finishes, retry this search."
    );
  }
}

export async function executeCatalogSearch(
  input: CatalogSearchInput
): Promise<CatalogSearchResult[]> {
  const limit = Math.min(input.limit ?? 20, 40);

  // Fast path: exact course code lookup
  if (input.course_code) {
    const normalized = input.course_code.toUpperCase().replace(/\s+/g, " ").trim();
    const course = await getCourse(normalized);
    if (course) {
      return [
        {
          courseCode: course.courseCode,
          title: course.title,
          credits: course.credits,
          totalSections: course.sections.length,
          sections: course.sections.slice(0, 8).map(compactSection),
        },
      ];
    }
    // Course not found — could be a typo OR an empty catalog. Probe before
    // returning an ambiguous empty array.
    await ensureCatalogLoaded();
    return [];
  }

  // Bulk path: subject-scoped or full-catalog sweep
  const courses: Course[] = input.subject
    ? await getCoursesBySubject(input.subject.toUpperCase())
    : await getAllCourses();

  // When the student picks a subject that has zero courses we can't tell
  // whether the subject genuinely has no offerings or the whole catalog is
  // empty. Probe to disambiguate.
  if (courses.length === 0) {
    await ensureCatalogLoaded();
    return [];
  }

  const keywordLower = input.keyword?.toLowerCase();
  const dayFilter = input.days && input.days.length > 0 ? input.days : null;

  const results: CatalogSearchResult[] = [];
  for (const course of courses) {
    const num = parseCourseNumber(course.courseCode);
    if (input.min_number != null && num < input.min_number) continue;
    if (input.max_number != null && num > input.max_number) continue;
    if (keywordLower && !course.title.toLowerCase().includes(keywordLower)) continue;

    let sections = course.sections;
    if (input.has_seats) sections = sections.filter((s) => s.seatsAvailable > 0);
    if (dayFilter) {
      sections = sections.filter((s) =>
        s.meetings.some((m) => dayFilter.every((d) => m.days.includes(d)))
      );
    }
    if (input.attributes && input.attributes.length > 0) {
      const wanted = input.attributes;
      sections = sections.filter((s) => wanted.every((q) => sectionHasAttribute(s, q)));
    }
    if (sections.length === 0) continue;

    results.push({
      courseCode: course.courseCode,
      title: course.title,
      credits: course.credits,
      totalSections: sections.length,
      sections: sections.slice(0, 5).map(compactSection),
    });

    if (results.length >= limit) break;
  }

  return results;
}

// ─── list_attributes ──────────────────────────────────────────────────────────

export interface AttributeSummary {
  code: string;
  description: string;
  sectionCount: number;
}

// Walks every cached section and aggregates the distinct attribute set. This is
// the "self-documenting taxonomy" call — Claude uses it to learn Fordham's
// requirement-tag codes (AMER, ICC, HUST, EP1, …) without any hardcoded list.
// Sorted by sectionCount desc so high-traffic core requirements surface first.
export async function executeListAttributes(): Promise<AttributeSummary[]> {
  const courses = await getAllCourses();
  if (courses.length === 0) {
    await ensureCatalogLoaded(); // throws the refresh-needed error
  }
  const byCode = new Map<string, { description: string; sectionCount: number }>();

  for (const course of courses) {
    for (const section of course.sections) {
      for (const attr of section.attributes ?? []) {
        const entry = byCode.get(attr.code);
        if (entry) {
          entry.sectionCount += 1;
        } else {
          byCode.set(attr.code, { description: attr.description, sectionCount: 1 });
        }
      }
    }
  }

  return Array.from(byCode.entries())
    .map(([code, { description, sectionCount }]) => ({ code, description, sectionCount }))
    .sort((a, b) => b.sectionCount - a.sectionCount);
}

// ─── Tool schemas (passed to Claude in `tools` array) ────────────────────────
// Keep descriptions terse — Claude reads these every turn.

export const SEARCH_CATALOG_TOOL = {
  name: "search_catalog",
  description:
    "Search Fordham's live course catalog for next semester's sections. Use this whenever the student asks about specific courses, electives, schedules, what's offered, open seats, professors, or requirement-tagged courses (e.g. 'American Pluralism', 'ICC', 'Eloquentia Perfecta'). NEVER guess course availability — always call this tool. Returns real CRNs, meeting times, instructors, seats, and the full attribute-code list per section. If the student asks about a requirement tag and you don't know the exact code, call list_attributes first.",
  input_schema: {
    type: "object" as const,
    properties: {
      subject: {
        type: "string",
        description: "Subject code, e.g. 'CISC', 'MATH', 'HIST'. Omit to search all subjects.",
      },
      course_code: {
        type: "string",
        description:
          "Exact course code like 'CISC 2010'. Use when you already know the course — fastest path.",
      },
      min_number: {
        type: "integer",
        description: "Minimum course number, e.g. 3000 for upper-division only.",
      },
      max_number: {
        type: "integer",
        description: "Maximum course number.",
      },
      keyword: {
        type: "string",
        description: "Match against course title, e.g. 'machine learning' or 'ethics'.",
      },
      days: {
        type: "array",
        items: { type: "string", enum: ["M", "T", "W", "R", "F"] },
        description:
          "Sections must meet on ALL of these days. R = Thursday. Example: ['T','R'] for Tuesday/Thursday sections.",
      },
      has_seats: {
        type: "boolean",
        description: "If true, only return sections with open seats.",
      },
      attributes: {
        type: "array",
        items: { type: "string" },
        description:
          "Fordham requirement tags that sections must carry. AND-intersected: a section must have EVERY tag listed here. Accepts either attribute codes (e.g. 'AMER', 'ICC') or description substrings (e.g. 'American Pluralism'). Example: ['ICC','AMER'] returns sections that satisfy BOTH ICC and American Pluralism. Call list_attributes if unsure of the exact code.",
      },
      limit: {
        type: "integer",
        description: "Max courses to return (default 20, cap 40).",
      },
    },
  },
};

export const LIST_ATTRIBUTES_TOOL = {
  name: "list_attributes",
  description:
    "List every distinct Fordham requirement-tag attribute present in the cached course catalog. Returns each attribute's code (e.g. 'AMER'), human description (e.g. 'American Pluralism'), and the number of sections carrying it next semester. Call this ONCE per conversation the first time a student asks about core curriculum, major requirements, or any requirement-tagged category — it teaches you the exact codes so subsequent search_catalog calls can filter by them accurately. No arguments needed.",
  input_schema: {
    type: "object" as const,
    properties: {},
  },
};
