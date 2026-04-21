// Maps raw Banner SSB section rows into our normalized Course/Section schema.
//
// Banner returns one row per section. We group by `subjectCourse` (e.g. "CISC2010")
// so one Course can hold many Sections. Banner quirks handled here:
//   - `creditHours` is frequently null; real credit count lives in `creditHourLow`
//   - meeting days are 7 separate booleans; we collapse to Day[] ("M" "T" "W" "R" "F")
//   - times are "1430" not "14:30"; we reformat for display
//   - instructor is an array; we take the primary, or first, or "TBA"
//   - deliveryMode is inferred from campusDescription + scheduleTypeDescription

import type { Course, Section, MeetingTime, Day, SectionAttribute } from "../../shared/types";
import type { BannerSection, BannerMeetingFaculty } from "./banner-ssb-client";

function formatTime(raw: string | null): string {
  if (!raw || raw.length !== 4) return "";
  return `${raw.slice(0, 2)}:${raw.slice(2)}`;
}

function daysFromMeeting(mt: BannerMeetingFaculty["meetingTime"]): Day[] {
  const days: Day[] = [];
  if (mt.monday) days.push("M");
  if (mt.tuesday) days.push("T");
  if (mt.wednesday) days.push("W");
  if (mt.thursday) days.push("R");
  if (mt.friday) days.push("F");
  return days;
}

function meetingsFromBanner(bsec: BannerSection): MeetingTime[] {
  return (bsec.meetingsFaculty ?? [])
    .map((mf) => {
      const mt = mf.meetingTime;
      const days = daysFromMeeting(mt);
      // Skip empty async-online rows with no schedule at all
      if (days.length === 0 && !mt.beginTime) return null;
      return {
        days,
        startTime: formatTime(mt.beginTime),
        endTime: formatTime(mt.endTime),
        building: mt.buildingDescription ?? mt.building ?? "",
        room: mt.room ?? "",
      } satisfies MeetingTime;
    })
    .filter((m): m is MeetingTime => m !== null);
}

function primaryInstructor(bsec: BannerSection): string {
  if (!bsec.faculty || bsec.faculty.length === 0) return "TBA";
  const primary = bsec.faculty.find((f) => f.primaryIndicator);
  return (primary ?? bsec.faculty[0]).displayName;
}

function deliveryMode(bsec: BannerSection): Section["deliveryMode"] {
  const campus = (bsec.campusDescription ?? "").toLowerCase();
  const schedule = (bsec.scheduleTypeDescription ?? "").toLowerCase();
  const method = (bsec.instructionalMethodDescription ?? "").toLowerCase();
  if (campus.includes("online") || schedule.includes("online") || method.includes("online")) {
    return "online";
  }
  if (method.includes("hybrid") || schedule.includes("hybrid")) {
    return "hybrid";
  }
  return "in_person";
}

function creditsFrom(bsec: BannerSection): number {
  return bsec.creditHours ?? bsec.creditHourLow ?? bsec.creditHourHigh ?? 0;
}

function attributesFromBanner(bsec: BannerSection): SectionAttribute[] {
  return (bsec.sectionAttributes ?? []).map((a) => ({
    code: a.code,
    description: a.description,
  }));
}

function sectionFromBanner(bsec: BannerSection): Section {
  return {
    crn: bsec.courseReferenceNumber,
    instructor: primaryInstructor(bsec),
    seatsAvailable: bsec.seatsAvailable,
    campus: bsec.campusDescription ?? "",
    deliveryMode: deliveryMode(bsec),
    meetings: meetingsFromBanner(bsec),
    attributes: attributesFromBanner(bsec),
  };
}

// Groups Banner sections by subjectCourse into our Course[] shape.
//
// Banner's searchResults response does NOT carry course descriptions or
// prerequisites — those live on per-CRN detail endpoints. Hydrate lazily when
// the AI tool asks about a specific course:
//
//   POST /searchResults/getCourseDescription
//        body: term=YYYYTT&courseReferenceNumber=CRN
//   POST /searchResults/getSectionPrerequisites
//        body: term=YYYYTT&courseReferenceNumber=CRN
//
// Both return HTML fragments, not JSON. Strip tags and cache by subjectCourse
// (not by CRN — one description covers every section of a course).
export function bannerSectionsToCourses(sections: BannerSection[]): Course[] {
  const byCourse = new Map<string, Course>();

  for (const bsec of sections) {
    const courseCode = `${bsec.subject} ${bsec.courseNumber}`;
    let course = byCourse.get(courseCode);
    if (!course) {
      course = {
        courseCode,
        subject: bsec.subject,
        title: bsec.courseTitle,
        credits: creditsFrom(bsec),
        description: "",
        prerequisites: "",
        sections: [],
      };
      byCourse.set(courseCode, course);
    }
    course.sections.push(sectionFromBanner(bsec));
  }

  return Array.from(byCourse.values()).sort((a, b) =>
    a.courseCode.localeCompare(b.courseCode)
  );
}
