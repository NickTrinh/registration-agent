import { describe, it, expect } from "vitest";
import { auditResponseToText } from "./degreeworks-audit-to-text";
import type { AuditResponse } from "../../shared/degreeworks-types";
import auditFixture from "../../../notes/fixtures/audit.fixture.json";

const audit = auditFixture as unknown as AuditResponse;

describe("auditResponseToText", () => {
  it("renders the fixture audit to the expected plain text", () => {
    expect(auditResponseToText(audit)).toMatchInlineSnapshot(`
      "=== DEGREEWORKS AUDIT ===
      Student: [NAME]
      GPA: 3.60
      Overall progress: 72% complete
      Credits applied: 84 resident + 6 transfer (12 in progress)

      --- Active goals ---
      MAJOR: Integrative Neuroscience (catalog 2024)
      MINOR: Computer Science (catalog 2024)
      CONC: Systems/Computational (catalog 2024)
      COLLEGE: Fordham College at Rose Hill
      Advisor: [ADVISOR] <[ADVISOR_EMAIL]>

      ### Core Curriculum [COMPLETE]
        credits applied: 30
        • Minimum 30 credits of core curriculum required
        [x] American Pluralism

      ### Major in Integrative Neuroscience [60% complete]
        credits applied: 18
        • Minimum 2.0 GPA in the major
        [ ] The Fine Arts
          → still need 1 of 1: any class with attribute = FACC
        [~] Neuroscience Core
          → applied: NEUR 2000 (IP)
          → still need 1 more class(es)
        [ ] Systems/Computational Concentration
          [ ] Coursework
            → still need 2 of 2: any class with attribute = NESY
        [ ] Research Experience
          → still need 1 of 1: NEUR 4990
        [ ] Research Experience Capstone
          → still need 1 of 1: NEUR 4999
        [ ] Major Elective
          → (audit did not expose specifics — call list_attributes + search_catalog to discover related sections)

      --- Courses in progress / preregistered ---
        [IP] NEUR 2000 (Fall 2026) — Cellular Neuroscience
        [PRE] PSYC 3400 (Fall 2026) — Cognition"
    `);
  });

  // The load-bearing test (ADR 0009 made machine-checked): the renderer is the
  // single PII boundary. It must never emit any identifying field even though
  // the fixture deliberately carries fabricated PII, and it MUST emit the
  // [NAME] placeholder token.
  it("never emits PII and always emits the [NAME] placeholder", () => {
    const text = auditResponseToText(audit);
    expect(text).not.toMatch(/Jane/);
    expect(text).not.toMatch(/Doe/);
    expect(text).not.toContain("A00000000");
    expect(text).not.toContain("test.advisor");
    expect(text).not.toContain("jane.doe@example.edu");
    expect(text).toContain("[NAME]");
    expect(text).toContain("[ADVISOR]");
    expect(text).toContain("[ADVISOR_EMAIL]");
  });

  it("surfaces the withArray ATTRIBUTE constraint on incomplete rules", () => {
    const text = auditResponseToText(audit);
    expect(text).toContain("with attribute = FACC");
    expect(text).toContain("with attribute = NESY");
  });

  it("renders concentration sibling rules within the major block", () => {
    const text = auditResponseToText(audit);
    expect(text).toContain("Systems/Computational Concentration");
    expect(text).toContain("Research Experience");
    expect(text).toContain("Research Experience Capstone");
  });

  it("emits the discovery hint for a bare-incomplete rule", () => {
    const text = auditResponseToText(audit);
    expect(text).toContain("audit did not expose specifics");
  });
});
