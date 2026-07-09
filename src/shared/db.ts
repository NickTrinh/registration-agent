import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Course } from "./types";

interface AppDB extends DBSchema {
  courseCatalog: {
    key: string; // courseCode
    value: Course;
    indexes: { bySubject: string };
  };
}

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

function getDB(): Promise<IDBPDatabase<AppDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>("fordham-helper", 1, {
      upgrade(db) {
        const courseStore = db.createObjectStore("courseCatalog", {
          keyPath: "courseCode",
        });
        courseStore.createIndex("bySubject", "subject");
      },
    });
  }
  return dbPromise;
}

// ─── Course Catalog ───────────────────────────────────────────────────────────

// Full-catalog REPLACE, not merge. refreshCatalog always hands us a term's
// complete section set in one call, so we clear the store before writing —
// otherwise courses that existed in a prior term but aren't in the new term
// linger as stale ghosts (the key is `courseCode`, which collides across terms,
// so put() overwrites matches but never removes the misses). The clear() and
// the put()s share ONE transaction: it's atomic, so a reader never observes an
// empty store mid-refresh and a crash can't leave the catalog half-cleared.
// clear() is queued first, so IndexedDB runs it before the writes.
// NOTE: this makes the catalog single-term by design. Multi-term (feature C)
// will need a term-scoped key — see ADR 0022.
// Implements: ADR 0022
export async function saveCourses(courses: Course[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("courseCatalog", "readwrite");
  await Promise.all([tx.store.clear(), ...courses.map((c) => tx.store.put(c)), tx.done]);
}

export async function getAllCourses(): Promise<Course[]> {
  const db = await getDB();
  return db.getAll("courseCatalog");
}

export async function getCoursesBySubject(subject: string): Promise<Course[]> {
  const db = await getDB();
  return db.getAllFromIndex("courseCatalog", "bySubject", subject);
}

export async function getCourse(courseCode: string): Promise<Course | undefined> {
  const db = await getDB();
  return db.get("courseCatalog", courseCode);
}
