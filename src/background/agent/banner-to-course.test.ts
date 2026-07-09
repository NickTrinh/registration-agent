import { describe, it, expect } from "vitest";
import { bannerSectionsToCourses } from "./banner-to-course";
import type { BannerSection } from "./banner-ssb-client";
import bannerFixture from "../../../notes/fixtures/banner-sections.fixture.json";

const sections = bannerFixture.data as unknown as BannerSection[];
const courses = bannerSectionsToCourses(sections);

describe("bannerSectionsToCourses", () => {
  it("maps every section to a distinct, alpha-sorted Course", () => {
    expect(courses).toHaveLength(10);
    const codes = courses.map((c) => c.courseCode);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
    expect(codes).toContain("CISC 2010");
    expect(codes).toContain("NEUR 2000");
  });

  it("carries section attributes through", () => {
    const os = courses.find((c) => c.courseCode === "CISC 3595")!;
    expect(os.sections[0].attributes.map((a) => a.code)).toEqual(["AMER", "ICC"]);
  });

  it("preserves the overlapping meeting time on two CISC sections", () => {
    const cs1 = courses.find((c) => c.courseCode === "CISC 2010")!;
    const cs2 = courses.find((c) => c.courseCode === "CISC 2000")!;
    for (const c of [cs1, cs2]) {
      expect(c.sections[0].meetings[0].days).toEqual(["M", "W", "F"]);
      expect(c.sections[0].meetings[0].startTime).toBe("14:30");
      expect(c.sections[0].meetings[0].endTime).toBe("15:45");
    }
  });

  it("falls back to creditHourLow when creditHours is null", () => {
    const neur = courses.find((c) => c.courseCode === "NEUR 2000")!;
    expect(neur.credits).toBe(4);
  });

  it("infers online delivery and drops the empty async meeting row", () => {
    const engl = courses.find((c) => c.courseCode === "ENGL 2000")!;
    expect(engl.sections[0].deliveryMode).toBe("online");
    expect(engl.sections[0].meetings).toHaveLength(0);
  });

  it("never lets the ztcEncodedImage badge reach a Course", () => {
    const serialized = JSON.stringify(courses);
    expect(serialized).not.toContain("ztcEncodedImage");
    expect(serialized).not.toContain("iVBORw0KGgo");
  });
});
