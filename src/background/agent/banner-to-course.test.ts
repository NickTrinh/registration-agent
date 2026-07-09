import { describe, it, expect } from "vitest";
import { bannerSectionsToCourses } from "./banner-to-course";
import type { BannerSection } from "./banner-ssb-client";
import bannerFixture from "../../../notes/fixtures/banner-sections.fixture.json";

const sections = bannerFixture.data as unknown as BannerSection[];
const courses = bannerSectionsToCourses(sections);

describe("bannerSectionsToCourses", () => {
  it("maps every section to a distinct, alpha-sorted Course", () => {
    expect(courses).toHaveLength(11);
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

  it("keeps both Saturday meeting blocks of the real CHEM 1331 lab (item 7)", () => {
    const chem = courses.find((c) => c.courseCode === "CHEM 1331")!;
    const meetings = chem.sections[0].meetings;
    expect(meetings).toHaveLength(2); // a section can meet in multiple blocks
    expect(meetings.every((m) => m.days.includes("S"))).toBe(true);
    expect(meetings[0].startTime).toBe("08:30");
    expect(meetings[1].startTime).toBe("09:30");
    expect(meetings[1].building).toBe(""); // null building coerced, block still kept
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

// A section that meets on weekend days. Banner encodes each day as its own
// boolean on meetingTime; we only need the fields the mapper reads. Kept inline
// (not in the shared fixture) so the fixture stays a faithful capture.
function weekendSection(flags: { saturday?: boolean; sunday?: boolean }): BannerSection {
  return {
    subject: "THEO",
    courseNumber: "3200",
    courseTitle: "Weekend Seminar",
    courseReferenceNumber: "90001",
    seatsAvailable: 5,
    creditHours: 3,
    campusDescription: "Rose Hill",
    scheduleTypeDescription: "Lecture",
    instructionalMethodDescription: "In Person",
    faculty: [{ displayName: "[NAME]", primaryIndicator: true }],
    sectionAttributes: [],
    meetingsFaculty: [
      {
        meetingTime: {
          beginTime: "0900",
          endTime: "1150",
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: flags.saturday ?? false,
          sunday: flags.sunday ?? false,
          building: "KH",
          buildingDescription: "Keating Hall",
          room: "101",
        },
      },
    ],
  } as unknown as BannerSection;
}

describe("weekend meeting days (item 7)", () => {
  it("maps a Saturday section to day 'S' instead of dropping it", () => {
    const [c] = bannerSectionsToCourses([weekendSection({ saturday: true })]);
    expect(c.sections[0].meetings).toHaveLength(1);
    expect(c.sections[0].meetings[0].days).toEqual(["S"]);
    expect(c.sections[0].meetings[0].startTime).toBe("09:00");
  });

  it("maps a Sunday section to day 'U'", () => {
    const [c] = bannerSectionsToCourses([weekendSection({ sunday: true })]);
    expect(c.sections[0].meetings[0].days).toEqual(["U"]);
  });

  it("keeps weekend days alongside weekday flags in order", () => {
    const raw = weekendSection({ saturday: true });
    raw.meetingsFaculty[0].meetingTime.friday = true;
    const [c] = bannerSectionsToCourses([raw]);
    expect(c.sections[0].meetings[0].days).toEqual(["F", "S"]);
  });
});
