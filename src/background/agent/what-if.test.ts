import { describe, it, expect } from "vitest";
import { buildWhatIfGoals, type WhatIfCurriculum } from "./what-if";

// A student currently majoring in NEUR with the NESY concentration at Rose Hill.
const CURRENT: WhatIfCurriculum = {
  major: "NEUR",
  concentration: "NESY",
  college: "FC",
};

describe("buildWhatIfGoals", () => {
  it("minor-add keeps the current major AND concentration", () => {
    const result = buildWhatIfGoals({ minor: "PHIL" }, CURRENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.goals).toEqual([
      { code: "MAJOR", value: "NEUR" },
      { code: "MINOR", value: "PHIL" },
      { code: "CONC", value: "NESY" },
      { code: "COLLEGE", value: "FC" },
    ]);
  });

  it("major-swap drops the old concentration", () => {
    const result = buildWhatIfGoals({ major: "PSYC" }, CURRENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.goals).toEqual([
      { code: "MAJOR", value: "PSYC" },
      { code: "COLLEGE", value: "FC" },
    ]);
  });

  it("honors an explicit concentration override", () => {
    const result = buildWhatIfGoals({ concentration: "NECB" }, CURRENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.goals).toEqual([
      { code: "MAJOR", value: "NEUR" },
      { code: "CONC", value: "NECB" },
      { code: "COLLEGE", value: "FC" },
    ]);
  });

  it("rejects an empty (no-op) request", () => {
    const result = buildWhatIfGoals({}, CURRENT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("at least one");
  });

  it("rejects a student with no declared major", () => {
    const result = buildWhatIfGoals({}, { major: "", concentration: null, college: "FC" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no declared major");
  });
});
