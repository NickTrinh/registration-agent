import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  ONBOARDING_SYSTEM_PROMPT,
  buildAdvisorSystemBlocks,
  buildProfileExtractionPrompt,
  buildOnboardingSystemBlocks,
} from "./prompts";

// Boundary tests for the ADR 0020 cache-block split. The split moved prompt
// sections across separate system blocks and silently dropped the "\n\n" that
// used to separate them, so section headers ran onto the previous line. These
// lock the STRUCTURE — separators, block order, and which blocks are cacheable —
// rather than snapshotting the copy, which churns on every wording change.

type Block = Anthropic.Messages.TextBlockParam;

const assemble = (blocks: Block[]): string => blocks.map((b) => b.text).join("");

const lastCachedIndex = (blocks: Block[]): number => {
  let last = -1;
  blocks.forEach((b, i) => {
    if (b.cache_control) last = i;
  });
  return last;
};

// Every block but the last must end in exactly one blank line, and no block may
// open with a newline — together that yields exactly one blank line at each
// junction once the blocks are concatenated.
const expectSeparatorDiscipline = (blocks: Block[]) => {
  blocks.forEach((block, i) => {
    const isLast = i === blocks.length - 1;
    expect(block.text.startsWith("\n"), `block ${i} must not open with a newline`).toBe(false);
    if (isLast) {
      expect(block.text.endsWith("\n"), `final block ${i} must not carry a trailing separator`).toBe(
        false,
      );
    } else {
      expect(block.text.endsWith("\n\n"), `block ${i} must end with the section separator`).toBe(
        true,
      );
      expect(block.text.endsWith("\n\n\n"), `block ${i} must end with exactly one blank line`).toBe(
        false,
      );
    }
  });
  expect(/\n\n\n/.test(assemble(blocks)), "assembled prompt must never contain a blank run").toBe(
    false,
  );
};

const ADVISOR_INPUT = {
  profile: "Classification: Senior | Major: Integrative Neuroscience",
  memoryIndex: "#1 [goal] wants a computational neuroscience PhD",
  auditText: "Student: [NAME]\n[ ] American Pluralism",
};

describe("buildAdvisorSystemBlocks", () => {
  const blocks = buildAdvisorSystemBlocks(ADVISOR_INPUT);

  it("emits stable / audit / volatile in that order", () => {
    expect(blocks).toHaveLength(3);
    expect(blocks[0].text).toContain("You are an AI academic advisor embedded");
    expect(blocks[1].text).toContain("=== LIVE DEGREEWORKS AUDIT ===");
    expect(blocks[2].text).toContain("## Student Profile");
    expect(blocks[2].text).toContain("## Memory Index");
  });

  it("keeps every block separated by exactly one blank line", () => {
    expectSeparatorDiscipline(blocks);
  });

  // The junctions the 0020 split actually broke. Asserted on the assembled text
  // so a future re-split that moves the separator onto a different block passes.
  it("assembles section boundaries with a blank line, not a run-on", () => {
    const assembled = assemble(blocks);
    expect(assembled).toContain("never invent CRNs or times\n\n=== LIVE DEGREEWORKS AUDIT ===");
    expect(assembled).toContain("==============================\n\n## Student Profile");
    expect(assembled).not.toContain("times=== LIVE");
    expect(assembled).not.toContain("==## Student Profile");
  });

  it("places the volatile block after the last cache breakpoint", () => {
    const volatileIndex = blocks.length - 1;
    expect(blocks[volatileIndex].cache_control).toBeUndefined();
    expect(lastCachedIndex(blocks)).toBeLessThan(volatileIndex);
  });

  it("stays within Anthropic's four cache breakpoints", () => {
    expect(blocks.filter((b) => b.cache_control).length).toBeLessThanOrEqual(4);
  });

  // The whole point of the split: churn in profile/memory must not rewrite a
  // cached block, or the prefix invalidates on every curator save.
  it("holds cached blocks byte-stable when volatile context changes", () => {
    const other = buildAdvisorSystemBlocks({
      ...ADVISOR_INPUT,
      profile: "Classification: Junior | Major: Physics",
      memoryIndex: "#9 [constraint] cannot take Friday classes",
    });
    expect(other[0].text).toBe(blocks[0].text);
    expect(other[1].text).toBe(blocks[1].text);
    expect(other[2].text).not.toBe(blocks[2].text);
  });

  it("keeps the stable block independent of the audit", () => {
    const other = buildAdvisorSystemBlocks({ ...ADVISOR_INPUT, auditText: "[x] Everything done" });
    expect(other[0].text).toBe(blocks[0].text);
    expect(other[1].text).not.toBe(blocks[1].text);
    expect(other[1].text).toContain("[x] Everything done");
  });

  it("preserves separators when profile, memory, and audit are all empty", () => {
    const empty = buildAdvisorSystemBlocks({ profile: "", memoryIndex: "", auditText: "" });
    expectSeparatorDiscipline(empty);
    expect(assemble(empty)).toContain("Audit not loaded.");
    expect(assemble(empty)).toContain("no memories yet");
  });
});

describe("buildOnboardingSystemBlocks", () => {
  const blocks = buildOnboardingSystemBlocks({ auditText: ADVISOR_INPUT.auditText });

  it("emits the intake prompt then the audit, both cached", () => {
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain("running a brief intake conversation");
    expect(blocks[1].text).toContain("=== LIVE DEGREEWORKS AUDIT ===");
    expect(blocks.every((b) => b.cache_control?.type === "ephemeral")).toBe(true);
  });

  it("keeps every block separated by exactly one blank line", () => {
    expectSeparatorDiscipline(blocks);
  });

  // Onboarding has no volatile segment, so its assembly is still byte-identical
  // to the pre-split single-block prompt. Guards a dedupe of the two audit-block
  // literals, which would hand this one an unwanted trailing separator.
  it("assembles exactly the pre-split single-block text", () => {
    expect(assemble(blocks)).toBe(
      `${ONBOARDING_SYSTEM_PROMPT}\n\n=== LIVE DEGREEWORKS AUDIT ===\n${ADVISOR_INPUT.auditText}\n==============================`,
    );
  });

  it("preserves separators when the audit is empty", () => {
    expectSeparatorDiscipline(buildOnboardingSystemBlocks({ auditText: "" }));
  });
});

// Untouched by the 0020 split (it postdates it) — a single string, no blocks.
// Locked here only for the ADR 0009 boundary: the template must never ask the
// model for identifying fields.
describe("buildProfileExtractionPrompt", () => {
  it("embeds the audit under its delimiter", () => {
    expect(buildProfileExtractionPrompt("AUDIT_BODY")).toContain("=== AUDIT ===\nAUDIT_BODY");
  });

  it("never requests name or advisor fields", () => {
    const prompt = buildProfileExtractionPrompt("Student: [NAME]");
    expect(prompt).not.toMatch(/Name:/);
    expect(prompt).not.toMatch(/Advisor:/);
  });
});
