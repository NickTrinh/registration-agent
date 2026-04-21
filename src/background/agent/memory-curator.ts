// Background memory curator — runs after every chat turn.
//
// Two-tier architecture:
//
//   1. Hard facts — explicit, student-stated, durable. Go straight into the
//      main memory store. Visible to Sonnet via the routing index.
//   2. Provisional interests — soft signals the student hinted at but didn't
//      commit to. Accumulate in a separate store with mention counts. When a
//      topic hits PROMOTION_THRESHOLD consistent mentions, it's promoted to a
//      real memory entry. When a hard fact on the same topic arrives later,
//      the provisional is absorbed (deleted — the hard fact supersedes it).
//
// The curator itself runs on Haiku (cheap, fast, fire-and-forget). Sonnet
// handles the main chat. See ADRs 0011 and 0012 for the full rationale.
//
// Stub mode (default): logs what it would have written; touches no storage.
// Write mode: persists hardFacts, updates provisional, promotes on threshold,
// and absorbs provisional rows superseded by hard facts.

import Anthropic from "@anthropic-ai/sdk";
import type { MemoryEntry, MemoryType, ProvisionalInterest } from "../../shared/types";
import {
  addMemory,
  loadMemories,
  memoriesToIndexText,
  loadProvisional,
  provisionalToIndexText,
  addProvisionalHit,
  promoteProvisional,
  absorbProvisionalByTopic,
  PROMOTION_THRESHOLD,
} from "./memory-store";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationTurn {
  user: string;
  assistant: string;
}

export interface CuratedHardFact {
  type: MemoryType;
  description: string;
  content: string;
  topic: string; // used to absorb matching provisional rows
  sourceQuote?: string; // verbatim snippet from the student's message
}

export interface CuratedProvisionalHit {
  topic: string;
  description: string;
  proposedType: MemoryType;
  framing: string; // short snippet of how the student phrased it
}

export interface CuratorResult {
  hardFacts: CuratedHardFact[];
  provisionalHits: CuratedProvisionalHit[];
  promoted: MemoryEntry[];
  absorbed: number;
}

export interface RunCuratorOptions {
  // If true, validated candidates are persisted. Default: false (stub — log
  // only, touch no storage). Flip to true once the prompt is tuned.
  write?: boolean;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

const CURATOR_SYSTEM_PROMPT = `You are a memory curator for an AI academic advisor helping a Fordham University student plan their courses. Your job is to scan the last several conversation turns and extract DURABLE facts about the student that will still be true weeks or months from now.

## Your output has THREE categories

You split what you extract into three arrays:

1. **hardFacts** — explicit, student-stated durable facts. These go straight into the long-term memory store. Use this ONLY when the student stated something clearly in their own words AND it is not derivable from their DegreeWorks audit.

2. **provisionalHits** — soft signals. The student hinted at an interest, asked about a subject area more than once, or gestured at a topic they might care about. These are NOT saved as full memories yet — they go into a provisional tally. When the same topic is reinforced across multiple turns (threshold: ${PROMOTION_THRESHOLD} mentions with consistent framing), it gets promoted to a real memory automatically. Your job on each turn is just to identify the topic + a short framing snippet; the promotion math is handled for you.

3. You do NOT need to emit a separate "promotions" array. The system promotes automatically when a provisional topic crosses the threshold. You only need to identify hits.

## Where facts come from — READ THIS FIRST

**Only the student's own messages are a source of facts.** The advisor's responses are context for interpreting what the student meant, but the advisor's responses are NEVER evidence of student facts. The advisor's responses are grounded in the student's DegreeWorks audit, which the advisor already has on every turn. If a fact appears in the advisor's reply but the student did not state it themselves in their own words, DO NOT extract it — it was already in the audit.

Before you extract any candidate, apply this two-part check:
1. **Did the STUDENT say this in their own words?** If no, drop it.
2. **Is this something the audit already contains (current enrollments, completed courses, credits, major/minor/concentration, remaining requirements, GPA, graduation thresholds)?** If yes, drop it — the audit is in the advisor's system prompt on every turn, so "remembering" audit facts is pure duplication.

If either check fails, the candidate is noise. Drop it.

## hardFact vs. provisionalHit — how to decide

- If the student **explicitly and unambiguously** stated a durable fact in their own words → **hardFact**
  - "I work library shifts Friday 1-5" → hardFact (constraint)
  - "I'm switching my minor from CS to Data Science" → hardFact (decision)
  - "I really want to take something on gender studies next semester" → hardFact (interest) — explicit and specific
- If the student **showed interest through questions or repeated mentions** but did NOT commit → **provisionalHit**
  - Asked about theology courses once: → provisionalHit (theology topic, single framing)
  - Asked about theology courses a second time with a specific angle: → another provisionalHit (same topic, new framing, system tallies)
  - Never explicitly said "I'm interested in theology", but the pattern is emerging: → the promotion threshold handles this

A good way to think about it: **hardFacts are statements. provisionalHits are patterns.**

## Framing consistency (for provisionalHits)

Two mentions of a topic only count as reinforcement if they point at the same underlying interest:
- "What theology classes are there?" + "Any theology with a Middle Eastern focus?" → CONSISTENT (both theology, second narrows the focus)
- "What theology classes?" + "What history classes?" → NOT CONSISTENT (different subjects — emit as two separate provisionalHits with different topics)
- "What CS electives?" + "What ML/AI electives?" → CONSISTENT (both computer science, narrowed to an area)

When you emit a provisionalHit, pick a **topic** string that will match the same way across turns. Prefer short, hierarchical identifiers: \`theology\`, \`theology/middle-east\`, \`cs/ai-ml\`, \`gender-studies\`. Reuse existing topic strings from the provisional store when the current turn reinforces an existing row. Avoid topics shorter than 3 characters — too-short topics cause spurious absorption matches.

## What to extract

Save memories that a future advising session would benefit from knowing, and that the student explicitly said. Use these types:

- interest — academic or career areas the student is drawn to (e.g. "ML electives for spring 2026", "interested in neuroscience research")
- constraint — schedule, location, or capability limits (e.g. "cannot attend Friday classes", "prefers morning sections")
- goal — multi-semester objectives the student stated (e.g. "planning to apply to grad school in computational neuroscience")
- decision — committed choices the student has made out loud (e.g. "switched from CS major to DS minor", "committed to working with Prof. X's lab")
- note — other durable facts that don't fit above (e.g. "works as library assistant Fri/Sat mornings")

## What NOT to extract

- **ANY fact derivable from the DegreeWorks audit.** This includes current enrollments, preregistered courses, completed courses, grades, GPA, credits earned/remaining, major, minor, concentration, catalog year, graduation requirements, remaining core requirements, specific course codes already in the audit, and the standard 124-credit / 60-resident-credit thresholds. The advisor already has all of this on every turn.
- Questions the student asked (ephemeral — that's this turn's topic, not a durable fact)
- The specific course being discussed as "the topic of this turn"
- Anything the advisor said that the student did not explicitly confirm ("the advisor recommended X" is not a student fact)
- Emotional reactions ("excited", "confused", "frustrated")
- Personal identifiers (real names, emails, Banner IDs — the audit renderer strips these)
- Uncertain guesses or paraphrased inferences — extract only what the student said literally

**Most turns will have NOTHING worth saving.** An empty memories array is the expected default. When in doubt, skip. A missed candidate costs nothing; a bad candidate pollutes the memory store permanently.

## Never save — sensitive categories

Do NOT extract or save anything the student discloses in these categories, even if they state it explicitly:
- Disabilities, diagnoses, medications, therapies
- Mental-health topics (anxiety, depression, crises, self-harm)
- Family crises, bereavements, medical emergencies
- Romantic or sexual relationships
- Immigration/legal status
- Finances (income, debt, food insecurity, housing instability)

These may be genuinely relevant to advising but are too sensitive to persist in a memory store. Acknowledge them in-conversation as appropriate, but do not emit a hardFact or provisionalHit for them. If you're unsure whether a fact falls in this category, err on the side of not saving.

## Duplicates

The existing memory index is shown below. Do NOT re-extract facts already in the index. If a new turn adds nuance to an existing memory, skip it — consolidation is handled separately.

## Worked examples

### Example 1 — Fully empty turn (the common case)

Last turn:
Student: "What do I still need to graduate?"
Advisor: [table listing remaining core requirements, major requirements, credit math pulled from the audit]

Correct output:
\`\`\`json
{"hardFacts": [], "provisionalHits": []}
\`\`\`

Why: the student asked a question and stated no durable fact. The advisor restated audit content. Nothing to save, no interest pattern to seed. An empty turn is the expected default.

### Example 2 — Pure browsing (no hits)

Last turn:
Student: "What CISC electives can I take next semester?"
Advisor: [search_catalog results listing sections]

Correct output:
\`\`\`json
{"hardFacts": [], "provisionalHits": []}
\`\`\`

Why: CISC is already the student's major (visible in audit). Asking what's available in your own major is browsing, not a new interest signal. No provisional hit either — the student is not hinting at anything the audit doesn't already know.

### Example 3 — Soft signal → provisionalHit

Last turn:
Student: "Are there any interesting theology classes next semester?"
Advisor: [search_catalog results]

Correct output:
\`\`\`json
{
  "hardFacts": [],
  "provisionalHits": [
    {"topic": "theology", "description": "Theology courses beyond required core",
     "proposedType": "interest", "framing": "asked about interesting theology classes"}
  ]
}
\`\`\`

Why: the student gestured at theology beyond their required core credit — could be a real interest or casual curiosity. Too weak for a hardFact. Seed it. If it recurs, it gets promoted.

### Example 4 — Reinforcement across turns (same topic, consistent framing)

Recent turns show the student asked about theology a turn ago. This turn:
Student: "Any theology classes focused on Middle Eastern traditions specifically?"
Advisor: [search_catalog results filtered]

Correct output:
\`\`\`json
{
  "hardFacts": [],
  "provisionalHits": [
    {"topic": "theology", "description": "Theology, specifically Middle East focus",
     "proposedType": "interest", "framing": "asked for theology on Middle Eastern traditions"}
  ]
}
\`\`\`

Why: same topic (\`theology\`) as the previous turn, narrower focus. Emit another hit on the same topic — the system increments the count and, if it crosses ${PROMOTION_THRESHOLD}, will promote automatically.

### Example 5 — Hard fact (explicit statement)

Last turn:
Student: "I really want to take something on gender studies next semester, even if it doesn't count toward anything required."
Advisor: [search_catalog results]

Correct output:
\`\`\`json
{
  "hardFacts": [
    {"type": "interest", "description": "Gender studies elective for next semester",
     "content": "Student explicitly stated interest in gender studies as an elective area for next semester, even if it doesn't count toward graduation requirements.",
     "topic": "gender-studies",
     "sourceQuote": "I really want to take something on gender studies next semester"}
  ],
  "provisionalHits": []
}
\`\`\`

Why: the student explicitly stated an interest in their own words, with enough specificity to act on. This is durable and not in the audit. Goes straight into memories.

### Example 6 — Hard constraint

Last turn:
Student: "Can you avoid Friday afternoon sections? I work library shifts Fridays 1-5."
Advisor: [search_catalog results filtered]

Correct output:
\`\`\`json
{
  "hardFacts": [
    {"type": "constraint", "description": "No Friday afternoons (library shift 1-5pm)",
     "content": "Student cannot attend class during Friday 1-5pm due to library work shift. Avoid Friday afternoon sections when recommending courses.",
     "topic": "schedule/friday-afternoon",
     "sourceQuote": "I work library shifts Fridays 1-5"}
  ],
  "provisionalHits": []
}
\`\`\`

## Output schema

Return a single JSON object with exactly these two arrays:

\`\`\`json
{
  "hardFacts": [
    { "type": "interest" | "constraint" | "goal" | "decision" | "note",
      "description": "<=10 words, specific enough to route on",
      "content": "1-3 sentences with the details the description omits",
      "topic": "short-slug-for-absorption-matching",
      "sourceQuote": "verbatim phrase from the student's message, ≤25 words" }
  ],
  "provisionalHits": [
    { "topic": "short-slug-matching-existing-rows-when-applicable",
      "description": "<=10 words, what it would become if promoted",
      "proposedType": "interest" | "constraint" | "goal" | "decision" | "note",
      "framing": "short snippet of how the student phrased it this turn" }
  ]
}
\`\`\`

### sourceQuote — provenance for trust

Every hardFact must include a \`sourceQuote\` pulled verbatim from the student's own message. It's shown back to the student in Settings as "you said: ..." so they can see exactly why each memory exists. Quote EXACTLY (no paraphrasing), keep it under ~25 words, and pull from the student's own words — never from the advisor's response. If you can't identify a concrete quote to cite, you're probably extracting a fact the student didn't actually state — drop the candidate.

Both arrays may be empty. Both arrays empty is the common, correct answer for most turns.

### Description quality — this matters

The description is the ONLY text the main advisor model sees until it calls \`recall_memory\`. If descriptions are vague, the advisor will skip recall and hallucinate from the index alone. Descriptions must be specific enough that match/no-match is obvious from the description alone.

BAD (too vague — forces recall just to check relevance):
- "academic interests"
- "schedule preference"
- "course decision"

GOOD (specific — advisor can route on description alone):
- "Middle Eastern theology / traditions"
- "No Friday afternoons (library shift 1-5pm)"
- "Switched from CS major to Data Science minor"

## Return format

Return ONLY the JSON object. No preamble, no explanation, no markdown fences. Just the JSON.`;

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function runCurator(
  apiKey: string,
  recentTurns: ConversationTurn[],
  options: RunCuratorOptions = {}
): Promise<CuratorResult> {
  const cleanedTurns = recentTurns
    .map((t) => ({ user: t.user.trim(), assistant: t.assistant.trim() }))
    .filter((t) => t.user.length > 0 && t.assistant.length > 0);

  const emptyResult: CuratorResult = {
    hardFacts: [],
    provisionalHits: [],
    promoted: [],
    absorbed: 0,
  };

  if (cleanedTurns.length === 0) return emptyResult;

  const existingMemories = await loadMemories();
  const existingProvisional = await loadProvisional();
  const memoryIndex = memoriesToIndexText(existingMemories) || "(none yet)";
  const provisionalIndex = provisionalToIndexText(existingProvisional) || "(none yet)";

  const transcript = cleanedTurns
    .map(
      (t, i) =>
        `Turn ${i + 1} (${i === cleanedTurns.length - 1 ? "most recent — this is the one you're scoring" : "earlier context"})\nStudent: ${t.user}\nAdvisor: ${t.assistant}`
    )
    .join("\n\n");

  const userContent =
`## Existing memories (do not re-extract)
${memoryIndex}

## Existing provisional interests (reuse topic slugs when this turn reinforces one)
${provisionalIndex}

## Recent conversation (last ${cleanedTurns.length} turn${cleanedTurns.length === 1 ? "" : "s"})

${transcript}

## Your task

Focus on the MOST RECENT turn. Earlier turns are context so you can detect reinforcement patterns. Return the JSON object described in the system prompt. Both arrays may be empty — that is the expected default for most turns.`;

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  let rawText: string;
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: CURATOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    rawText = extractTextFromResponse(response);
  } catch (err) {
    console.warn("[Curator] Haiku call failed:", err);
    return emptyResult;
  }

  const { hardFacts, provisionalHits } = parseCuratorOutput(rawText);

  const result: CuratorResult = {
    hardFacts,
    provisionalHits,
    promoted: [],
    absorbed: 0,
  };

  if (options.write === true) {
    // Hard facts → memories + absorb matching provisional rows.
    for (const fact of hardFacts) {
      try {
        await addMemory({
          type: fact.type,
          description: fact.description,
          content: fact.content,
          sourceQuote: fact.sourceQuote,
        });
        if (fact.topic) {
          const absorbed = await absorbProvisionalByTopic(fact.topic);
          result.absorbed += absorbed;
        }
      } catch (err) {
        console.warn("[Curator] addMemory failed for hard fact:", fact, err);
      }
    }

    // Provisional hits → increment counters, promote when threshold met.
    for (const hit of provisionalHits) {
      try {
        const updated = await addProvisionalHit({
          topic: hit.topic,
          description: hit.description,
          proposedType: hit.proposedType,
          framing: hit.framing,
        });
        if (updated.count >= PROMOTION_THRESHOLD) {
          const promoted = await promoteProvisional(updated.id);
          if (promoted) result.promoted.push(promoted);
        }
      } catch (err) {
        console.warn("[Curator] provisional update failed for hit:", hit, err);
      }
    }
  }

  logResult(result, rawText, options.write === true);
  return result;
}

// ─── Parsing & Validation ────────────────────────────────────────────────────

function extractTextFromResponse(response: Anthropic.Messages.Message): string {
  return response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Haiku sometimes wraps JSON in markdown fences despite the instruction not
// to. Strip them defensively. Returns validated hardFacts and provisionalHits;
// any malformed entry is silently dropped. Best-effort by design.
function parseCuratorOutput(text: string): {
  hardFacts: CuratedHardFact[];
  provisionalHits: CuratedProvisionalHit[];
} {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const empty = { hardFacts: [], provisionalHits: [] };
  if (!stripped) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object") return empty;
  const obj = parsed as Record<string, unknown>;
  const hardFactsRaw = Array.isArray(obj.hardFacts) ? obj.hardFacts : [];
  const hitsRaw = Array.isArray(obj.provisionalHits) ? obj.provisionalHits : [];
  return {
    hardFacts: hardFactsRaw
      .map(validateHardFact)
      .filter((f): f is CuratedHardFact => f !== null),
    provisionalHits: hitsRaw
      .map(validateProvisionalHit)
      .filter((h): h is CuratedProvisionalHit => h !== null),
  };
}

const VALID_TYPES: ReadonlySet<MemoryType> = new Set([
  "interest",
  "constraint",
  "goal",
  "decision",
  "note",
]);

function validateHardFact(raw: unknown): CuratedHardFact | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  const description = obj.description;
  const content = obj.content;
  const topic = obj.topic;
  const sourceQuote = obj.sourceQuote;
  if (typeof type !== "string" || !VALID_TYPES.has(type as MemoryType)) return null;
  if (typeof description !== "string" || description.trim().length === 0) return null;
  if (typeof content !== "string" || content.trim().length === 0) return null;
  return {
    type: type as MemoryType,
    description: description.trim(),
    content: content.trim(),
    topic: typeof topic === "string" ? topic.trim() : "",
    sourceQuote:
      typeof sourceQuote === "string" && sourceQuote.trim().length > 0
        ? sourceQuote.trim()
        : undefined,
  };
}

function validateProvisionalHit(raw: unknown): CuratedProvisionalHit | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const topic = obj.topic;
  const description = obj.description;
  const proposedType = obj.proposedType;
  const framing = obj.framing;
  if (typeof topic !== "string" || topic.trim().length === 0) return null;
  if (typeof description !== "string" || description.trim().length === 0) return null;
  if (typeof proposedType !== "string" || !VALID_TYPES.has(proposedType as MemoryType)) return null;
  if (typeof framing !== "string" || framing.trim().length === 0) return null;
  return {
    topic: topic.trim(),
    description: description.trim(),
    proposedType: proposedType as MemoryType,
    framing: framing.trim(),
  };
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function logResult(result: CuratorResult, rawText: string, willWrite: boolean): void {
  const tag = willWrite ? "[Curator] WRITE" : "[Curator] STUB";
  const { hardFacts, provisionalHits, promoted, absorbed } = result;

  if (hardFacts.length === 0 && provisionalHits.length === 0) {
    console.log(`${tag} — no candidates (empty turn).`);
    if (rawText && !/^\{\s*"hardFacts"\s*:\s*\[\s*\]\s*,\s*"provisionalHits"\s*:\s*\[\s*\]\s*\}$/.test(rawText)) {
      console.log(`${tag} raw response was:`, rawText);
    }
    return;
  }

  if (hardFacts.length > 0) {
    console.log(`${tag} — ${hardFacts.length} hard fact${hardFacts.length === 1 ? "" : "s"}:`);
    for (const f of hardFacts) {
      console.log(`  • [${f.type}] ${f.description}  (topic: ${f.topic || "—"})`);
      console.log(`    ${f.content}`);
    }
  }

  if (provisionalHits.length > 0) {
    console.log(`${tag} — ${provisionalHits.length} provisional hit${provisionalHits.length === 1 ? "" : "s"}:`);
    for (const h of provisionalHits) {
      console.log(`  • [${h.proposedType}] ${h.topic} — ${h.description}`);
      console.log(`    framing: "${h.framing}"`);
    }
  }

  if (willWrite) {
    if (promoted.length > 0) {
      console.log(`${tag} — ${promoted.length} promoted to memories:`);
      for (const m of promoted) {
        console.log(`  → #${m.id} [${m.type}] ${m.description}`);
      }
    }
    if (absorbed > 0) {
      console.log(`${tag} — ${absorbed} provisional row${absorbed === 1 ? "" : "s"} absorbed by new hard facts.`);
    }
  }
}

// Re-export so callers importing the curator don't also need memory-store.
export type { MemoryEntry, ProvisionalInterest };
