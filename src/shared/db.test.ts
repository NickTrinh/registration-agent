import { describe, it, expect, beforeEach } from "vitest";
import { saveCourses, getAllCourses, getCourse } from "./db";
import type { Course } from "./types";

// Minimal Course builder — only the fields these tests assert on matter.
function course(courseCode: string, title = courseCode): Course {
  const [subject] = courseCode.split(" ");
  return {
    courseCode,
    subject,
    title,
    credits: 3,
    description: "",
    prerequisites: "",
    sections: [],
  };
}

describe("saveCourses (catalog replace semantics)", () => {
  beforeEach(async () => {
    // Land at a known baseline regardless of prior test order: two courses.
    await saveCourses([course("CISC 2010"), course("NEUR 2000")]);
  });

  it("writes the given courses", async () => {
    const all = await getAllCourses();
    expect(all.map((c) => c.courseCode).sort()).toEqual(["CISC 2010", "NEUR 2000"]);
  });

  it("REPLACES the catalog on the next save — no stale cross-term ghosts", async () => {
    // Simulate switching terms: the new term has NEUR 2000 (updated) + a course
    // CISC 2010 does not offer. The old-term-only course must not linger.
    await saveCourses([course("NEUR 2000", "Updated Title"), course("PHIL 1000")]);

    const all = await getAllCourses();
    expect(all.map((c) => c.courseCode).sort()).toEqual(["NEUR 2000", "PHIL 1000"]);
    expect(await getCourse("CISC 2010")).toBeUndefined(); // the ghost is gone
    expect((await getCourse("NEUR 2000"))?.title).toBe("Updated Title"); // updated, not duplicated
  });

  it("clears the store when handed an empty catalog", async () => {
    await saveCourses([]);
    expect(await getAllCourses()).toHaveLength(0);
  });
});
