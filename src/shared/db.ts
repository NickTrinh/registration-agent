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

export async function saveCourses(courses: Course[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("courseCatalog", "readwrite");
  await Promise.all([...courses.map((c) => tx.store.put(c)), tx.done]);
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
