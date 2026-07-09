import { useState, useEffect, useRef } from "react";
import { prefersReducedMotion } from "../theme";
import { conversationalOnly } from "../../shared/types";
import type {
  ConversationMessage,
  ToolEvent,
  SystemActionItem,
  MemoryType,
} from "../../shared/types";
import Message from "../components/Message";
import Notice from "../components/Notice";
import StatusStrip from "../components/StatusStrip";
import FirstRun, { DEGREEWORKS_URL } from "../components/FirstRun";

const SUGGESTIONS = [
  "What do I still need to graduate?",
  "What core requirements am I missing?",
  "What electives can I take next semester?",
  "How many credits do I have left?",
];

// Implements: ADR 0024 — the advisor tells the truth about what it's doing.
// When a tool call is awaiting its result the indicator reports THAT (see
// TOOL_PHRASES); this rotating list covers only the pure-reasoning gap, and
// it stays in the registrar's world — personality through specificity.
const THINKING_PHRASES = [
  "Consulting the audit",
  "Cross-checking blocks",
  "Flipping through requirements",
  "Wrangling credits",
  "Squinting at course codes",
  "Reading the core's fine print",
  "Counting your credits twice",
  "Petitioning the registrar",
  "Comparing section times",
  "Channeling your advisor",
];

// What each tool is actually doing, in plain words. "Searching the catalog"
// beats "Pondering" when it is literally searching the catalog.
const TOOL_PHRASES: Record<string, string> = {
  search_catalog: "Searching the catalog",
  list_attributes: "Checking attribute codes",
  recall_memory: "Recalling what I know",
  save_memory: "Saving a memory",
  forget_memory: "Updating my memory",
  run_what_if: "Running a what-if audit",
};

const SESSION_KEY = "chat_messages";
const ONBOARDING_MODE_KEY = "chat_onboarding_mode";
const SHOW_CONTINUE_KEY = "chat_show_continue";

function persistSession(
  msgs: ConversationMessage[],
  onboarding: boolean,
  showContinue: boolean
) {
  chrome.storage.session.set({
    [SESSION_KEY]: msgs,
    [ONBOARDING_MODE_KEY]: onboarding,
    [SHOW_CONTINUE_KEY]: showContinue,
  });
}

export default function AuditChat({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Turn-scoped system events (ADR 0026): errors and loop-exit notices are
  // never advisor messages and never enter `messages` — they render as
  // <Notice>s anchored under the thread. One slot each; cleared on next turn.
  const [turnError, setTurnError] = useState<string | null>(null);
  const [turnNotice, setTurnNotice] = useState<"tool-cap" | "truncated" | null>(null);

  // FirstRun prerequisites, read from chrome.storage.local (the worker keeps
  // both current) and live-tracked so checkmarks flip while the student sets
  // up from the Settings tab.
  const [hasKey, setHasKey] = useState(false);
  const [catalogCount, setCatalogCount] = useState(0);
  // Nothing paints in the empty state until the onboarding round-trips
  // resolve — kills the suggestions→welcome-card flash on first launch.
  const [welcomeDecided, setWelcomeDecided] = useState(false);

  const [auditText, setAuditText] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditExpired, setAuditExpired] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  // First name and advisor email live in chrome.storage.local, written by
  // the service worker during refreshAudit. Used only for client-side
  // [NAME] / [ADVISOR_EMAIL] substitution — never transmitted anywhere.
  const [firstName, setFirstName] = useState<string | null>(null);
  const [advisorEmail, setAdvisorEmail] = useState<string | null>(null);
  const [advisorName, setAdvisorName] = useState<string | null>(null);

  // Onboarding state
  // - showWelcomeCard: decided once on mount based on memory count + stored
  //   completion flag. Once true, stays true until the student clicks start
  //   or skip. Never re-derived from runtime memory changes.
  // - onboardingMode: when true, SEND_MESSAGE passes mode: "onboarding" so
  //   the worker swaps Sonnet's system prompt and tool set.
  const [showWelcomeCard, setShowWelcomeCard] = useState(false);
  const [onboardingMode, setOnboardingMode] = useState(false);

  // End-of-intake state. `onboardingFinalized` flips when the worker emits
  // ONBOARDING_SAVES_DONE — the save batch has committed but Sonnet's wrap-up
  // text is still streaming. `showContinueButton` flips when the subsequent
  // AI_DONE fires, rendering the inline "Continue to chat →" button under
  // the wrap-up bubble. The button — not a timer — gates the transition, so
  // the student has time to read the conversation and the saved memories.
  const [onboardingFinalized, setOnboardingFinalized] = useState(false);
  const [showContinueButton, setShowContinueButton] = useState(false);

  // Rotating "thinking..." phrase shown while Sonnet is reasoning between
  // the user's message and its first visible output. Rotates every 2.5s.
  const [thinkingPhrase, setThinkingPhrase] = useState(THINKING_PHRASES[0]);

  // Single-slot memory-save toast: broadcast by the service worker whenever
  // the curator writes a memory (or Sonnet's save_memory tool fires in
  // normal mode). Auto-dismisses after 3s, replaced immediately by a new
  // one if another save fires before the timer. Keeps the chat uncluttered.
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastCounter = useRef(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll user-lock. Two parallel sources of truth:
  //  - `isAtBottomRef` drives the scroll effect (no re-render, no stale
  //    closure — the effect reads current at-bottom-ness at scroll time).
  //  - `isAtBottom` state drives the "↓ Jump to latest" button so it can
  //    re-render on flip. We update the state only when the value actually
  //    changes to avoid a re-render per scroll event.
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Load audit text + profile + first name + restore session on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_AUDIT_TEXT" }, (res) => {
      if (res?.text) setAuditText(res.text);
    });
    chrome.runtime.sendMessage({ type: "GET_PROFILE" }, (res) => {
      if (res?.profile) setProfile(res.profile);
    });
    chrome.storage.local.get(
      ["studentFirstName", "studentAdvisorEmail", "studentAdvisorName"],
      (r) => {
        if (r.studentFirstName) setFirstName(r.studentFirstName as string);
        if (r.studentAdvisorEmail) setAdvisorEmail(r.studentAdvisorEmail as string);
        if (r.studentAdvisorName) setAdvisorName(r.studentAdvisorName as string);
      }
    );

    // FirstRun prerequisites + status-strip course count.
    chrome.storage.local.get(["anthropicApiKey", "catalogCourseCount"], (r) => {
      setHasKey(typeof r.anthropicApiKey === "string" && r.anthropicApiKey.length > 0);
      setCatalogCount((r.catalogCourseCount as number) ?? 0);
    });
    const onStorageChange = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "local") return;
      if (changes.anthropicApiKey) {
        const v = changes.anthropicApiKey.newValue;
        setHasKey(typeof v === "string" && v.length > 0);
      }
      if (changes.catalogCourseCount) {
        setCatalogCount((changes.catalogCourseCount.newValue as number) ?? 0);
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);

    // Restore chat session from chrome.storage.session (survives panel
    // close/reopen within the same browser session, clears on browser quit).
    chrome.storage.session.get(
      [SESSION_KEY, ONBOARDING_MODE_KEY, SHOW_CONTINUE_KEY],
      (r) => {
      const saved = r[SESSION_KEY] as ConversationMessage[] | undefined;
      const savedMode = r[ONBOARDING_MODE_KEY] as boolean | undefined;
      const savedShowContinue = r[SHOW_CONTINUE_KEY] as boolean | undefined;
      if (Array.isArray(saved) && saved.length > 0) {
        setMessages(saved);
        if (savedMode) setOnboardingMode(true);
        if (savedShowContinue) setShowContinueButton(true);
        setWelcomeDecided(true);
        return; // session has history — skip onboarding check
      }

      // No session history — decide whether to show the onboarding welcome
      // card. Conditions: no memories yet AND onboarding never completed.
      chrome.runtime.sendMessage({ type: "GET_ONBOARDING_STATE" }, (s) => {
        const completedAt = (s?.completedAt as number | null) ?? null;
        chrome.runtime.sendMessage({ type: "GET_MEMORIES" }, (m) => {
          const count = Array.isArray(m?.memories) ? m.memories.length : 0;
          if (count === 0 && completedAt === null) {
            setShowWelcomeCard(true);
          }
          setWelcomeDecided(true);
        });
      });
    });

    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);

  // Persist messages to session storage whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      persistSession(messages, onboardingMode, showContinueButton);
    }
  }, [messages, onboardingMode, showContinueButton]);

  // On unmount (side-panel close), abort any in-flight chat so the service
  // worker stops burning tokens. The partial response already in session
  // storage stays visible on reopen; the user re-sends if they want more.
  const loadingRef = useRef(false);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // Mirror `onboardingFinalized` into a ref so the AI_DONE listener (which
  // is registered once at mount with an empty dep array) can read the
  // current value without a stale-closure.
  const onboardingFinalizedRef = useRef(false);
  useEffect(() => {
    onboardingFinalizedRef.current = onboardingFinalized;
  }, [onboardingFinalized]);
  useEffect(() => {
    return () => {
      if (loadingRef.current) {
        chrome.runtime.sendMessage({ type: "CANCEL_AI_CHAT" });
      }
    };
  }, []);

  // Auto-dismiss the toast after 3s. Replaced immediately (timer resets)
  // when a new save broadcast arrives, so rapid successive saves don't queue
  // up — the most recent one wins and the previous fades away.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Rotate the thinking phrase every 2.5s while loading. Reset to a random
  // starting phrase each time loading kicks in so consecutive turns don't
  // always lead with the same word.
  useEffect(() => {
    if (!loading) return;
    setThinkingPhrase(
      THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)]
    );
    const interval = setInterval(() => {
      setThinkingPhrase((prev) => {
        let next = prev;
        while (next === prev) {
          next = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
        }
        return next;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [loading]);

  // Listen for service worker broadcasts
  useEffect(() => {
    const listener = (message: any) => {
      switch (message.type) {
        case "AI_CHUNK":
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            // Only append to the last bubble if it's a normal AI bubble.
            // systemAction bubbles are non-append targets so Sonnet's wrap-up
            // text after complete_onboarding lands in a fresh Bubble B.
            if (last?.role === "assistant" && !last.systemAction) {
              return [...prev.slice(0, -1), { ...last, content: last.content + message.delta }];
            }
            return [...prev, { role: "assistant", content: message.delta, timestamp: new Date().toISOString() }];
          });
          break;
        case "AI_DONE":
          setLoading(false);
          // Strip a trailing empty assistant bubble if Sonnet finished with
          // tool_use blocks only and no text — otherwise we'd render a blank
          // bubble. A bubble with completed tool chips but no text stays (so
          // the student sees the search happened). systemAction bubbles are
          // skipped by this cleanup since their "text content" is the items
          // list, not the .content field.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (
              last?.role === "assistant" &&
              !last.systemAction &&
              last.content.trim() === "" &&
              (last.toolEvents ?? []).length === 0
            ) {
              return prev.slice(0, -1);
            }
            return prev;
          });
          // If the save batch committed during this turn, the wrap-up bubble
          // just finished streaming — show the Continue button now. The user
          // dismisses it at their own pace; input stays disabled meanwhile.
          if (onboardingFinalizedRef.current) {
            setShowContinueButton(true);
            setOnboardingFinalized(false);
            onboardingFinalizedRef.current = false;
          }
          break;
        case "AI_ERROR":
          // Never the advisor's voice: the raw error renders as a turn-scoped
          // <Notice> below the thread, quoted in mono — and never enters
          // `messages`, so nothing needs stripping before send. This is
          // ADR 0028's Alternative B, adopted per its own revisit clause;
          // the uiOnly flag it replaced is deleted, not left dangling.
          // Implements: ADR 0026.
          setTurnError(String(message.error ?? "Unknown error"));
          setLoading(false);
          break;
        case "AI_NOTICE":
          // Loop-exit conditions (tool cap, truncation) — ours to say, not
          // the advisor's. Implements: ADR 0026.
          setTurnNotice(message.kind === "tool-cap" ? "tool-cap" : "truncated");
          break;
        case "AI_TOOL_USE":
          // complete_onboarding is handled by the ONBOARDING_SAVES_* broadcast
          // trio (which renders a distinct systemAction bubble) — we skip
          // making a generic tool-event chip for it.
          if (message.name === "complete_onboarding") break;
          setMessages((prev) => {
            const event: ToolEvent = {
              name: message.name,
              input: message.input ?? {},
            };
            const last = prev[prev.length - 1];
            // Attach to the last bubble only if it's a normal AI bubble.
            // systemAction bubbles are non-append targets.
            if (last?.role === "assistant" && !last.systemAction) {
              const updated: ConversationMessage = {
                ...last,
                toolEvents: [...(last.toolEvents ?? []), event],
              };
              return [...prev.slice(0, -1), updated];
            }
            // First tool call before any assistant text — synthesize an empty
            // assistant bubble so the chip has a message to hang off of. The
            // streaming AI_CHUNK handler will fill in content onto this same
            // message afterward.
            return [
              ...prev,
              {
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                toolEvents: [event],
              },
            ];
          });
          break;
        case "AI_TOOL_RESULT":
          // Walk back from the last assistant message and fill in the most
          // recent tool event that's still missing a courseCount. Matching
          // by position is safe because the worker emits tool_use/tool_result
          // in strict order per turn. complete_onboarding is skipped — it has
          // no chip (handled by the ONBOARDING_SAVES_* broadcast trio), so
          // threading a result into an unrelated sibling chip would be wrong.
          if (message.name === "complete_onboarding") break;
          setMessages((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const m = prev[i];
              if (m.role !== "assistant" || !m.toolEvents) continue;
              for (let j = m.toolEvents.length - 1; j >= 0; j--) {
                if (m.toolEvents[j].courseCount === undefined) {
                  const updatedEvents = m.toolEvents.slice();
                  updatedEvents[j] = {
                    ...updatedEvents[j],
                    courseCount: message.courseCount,
                    // Present only when the tool threw. Carried so the chip can
                    // render a failed state instead of claiming "0 results".
                    error: message.error,
                  };
                  const updatedMsg = { ...m, toolEvents: updatedEvents };
                  return [...prev.slice(0, i), updatedMsg, ...prev.slice(i + 1)];
                }
              }
              break;
            }
            return prev;
          });
          break;
        case "AUDIT_TEXT_READY":
          setAuditText(message.text);
          setAuditError(null);
          // First name and advisor email were just (re)written by the service
          // worker during refreshAudit; re-read both so [NAME]/[ADVISOR_EMAIL]
          // substitution in the next chat turn picks up the fresh values.
          chrome.storage.local.get(
            ["studentFirstName", "studentAdvisorEmail", "studentAdvisorName"],
            (r) => {
              setFirstName((r.studentFirstName as string) ?? null);
              setAdvisorEmail((r.studentAdvisorEmail as string) ?? null);
              setAdvisorName((r.studentAdvisorName as string) ?? null);
            }
          );
          break;
        case "PROFILE_LOADING":
          setProfileLoading(true);
          break;
        case "PROFILE_READY":
          setProfile(message.profile);
          setProfileLoading(false);
          break;
        case "PROFILE_ERROR":
          setProfileLoading(false);
          break;
        case "AUDIT_LOADING":
          setAuditError(null);
          setAuditExpired(false);
          break;
        case "AUDIT_EXPIRED":
          setAuditExpired(true);
          setAuditError(null);
          break;
        case "AUDIT_ERROR":
          setAuditError(message.error ?? "Audit fetch failed");
          break;
        case "AI_CURATOR_SAVED": {
          const desc = typeof message.description === "string" ? message.description : "memory saved";
          toastCounter.current += 1;
          setToast({ id: toastCounter.current, text: desc });
          break;
        }
        case "ONBOARDING_SAVES_START": {
          // Insert the systemAction bubble (Bubble A — the "Saving your
          // profile…" list). Each subsequent ONBOARDING_SAVE_COMMITTED marks
          // one row as saved. Sonnet's wrap-up text then streams into a
          // fresh Bubble B since the systemAction bubble is a non-append
          // target for AI_CHUNK.
          const rawItems = Array.isArray(message.items) ? message.items : [];
          const items: SystemActionItem[] = rawItems
            .map((it: unknown) => {
              const o = it as { type?: string; description?: string; sourceQuote?: string };
              return {
                type: (o.type as MemoryType) ?? "note",
                description: o.description ?? "",
                sourceQuote: o.sourceQuote,
                status: "pending" as const,
              };
            });
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "",
              timestamp: new Date().toISOString(),
              systemAction: { kind: "onboarding-saves", items, done: false },
            },
          ]);
          break;
        }
        case "ONBOARDING_SAVE_COMMITTED": {
          const idx = typeof message.index === "number" ? message.index : -1;
          if (idx < 0) break;
          setMessages((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const m = prev[i];
              if (!m.systemAction || m.systemAction.kind !== "onboarding-saves") continue;
              if (idx >= m.systemAction.items.length) return prev;
              const nextItems = m.systemAction.items.slice();
              nextItems[idx] = { ...nextItems[idx], status: "saved" };
              const updated: ConversationMessage = {
                ...m,
                systemAction: { ...m.systemAction, items: nextItems },
              };
              return [...prev.slice(0, i), updated, ...prev.slice(i + 1)];
            }
            return prev;
          });
          break;
        }
        case "ONBOARDING_SAVES_DONE": {
          // Mark the bubble done, exit onboarding mode immediately so any
          // next user turn routes through the normal system prompt, and
          // remember that this turn is the finalizer — AI_DONE then shows
          // the Continue-to-chat button.
          setMessages((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const m = prev[i];
              if (!m.systemAction || m.systemAction.kind !== "onboarding-saves") continue;
              const updated: ConversationMessage = {
                ...m,
                systemAction: { ...m.systemAction, done: true },
              };
              return [...prev.slice(0, i), updated, ...prev.slice(i + 1)];
            }
            return prev;
          });
          setOnboardingMode(false);
          setOnboardingFinalized(true);
          onboardingFinalizedRef.current = true;
          break;
        }
        case "ONBOARDING_COMPLETED": {
          // Sent by the worker whenever the completion flag is set — from
          // complete_onboarding (normal intake end) AND from skipOnboarding.
          // Just make sure the welcome card and intake mode are down; the
          // Continue button is managed via the SAVES_DONE → AI_DONE chain.
          setShowWelcomeCard(false);
          setOnboardingMode(false);
          break;
        }
        case "ONBOARDING_RESET": {
          // Student clicked "Re-run onboarding" in Settings. Wipe this tab's
          // chat state without forcing a close/reopen of the side panel.
          setMessages([]);
          setOnboardingMode(false);
          setOnboardingFinalized(false);
          onboardingFinalizedRef.current = false;
          setShowContinueButton(false);
          setShowWelcomeCard(true);
          chrome.storage.session.remove([SESSION_KEY, ONBOARDING_MODE_KEY, SHOW_CONTINUE_KEY]);
          break;
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Track whether the user is near the bottom of the scroll container.
  // Everyone-has-frustration pattern: if an AI chat yanks the user back to
  // the bottom while they're trying to re-read something earlier, they lose
  // their place. Standard fix — only auto-scroll when the user is already at
  // the bottom; show a "↓" button when they've scrolled up.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const BOTTOM_THRESHOLD = 40; // px — small buffer so "near bottom" counts
    const onScroll = () => {
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        BOTTOM_THRESHOLD;
      isAtBottomRef.current = atBottom;
      setIsAtBottom((prev) => (prev === atBottom ? prev : atBottom));
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll only when the user is already at the bottom. If they've
  // scrolled up, respect their position — the "Jump to latest" button lets
  // them catch up on demand.
  useEffect(() => {
    if (isAtBottomRef.current) {
      // `behavior` is a JS argument, so the reduced-motion block in styles.css
      // cannot reach it. Read the query here instead.
      bottomRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [messages, showContinueButton]);

  function scrollToBottomImmediately() {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    });
  }

  // Unified send path. `modeOverride` is used by startOnboarding where the
  // setOnboardingMode(true) state update hasn't flushed yet at the time the
  // first message is dispatched — the caller passes "onboarding" explicitly
  // instead of relying on state.
  function sendMessage(text: string, modeOverride?: "onboarding" | "normal") {
    if (!text.trim() || loading) return;
    const mode = modeOverride ?? (onboardingMode ? "onboarding" : "normal");

    const userMsg: ConversationMessage = {
      role: "user",
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    // A new turn supersedes the previous turn's system events.
    setTurnError(null);
    setTurnNotice(null);
    // User is actively starting a new exchange — they should see their own
    // message and the incoming reply. Release any scroll-up lock so the
    // response auto-scrolls into view.
    scrollToBottomImmediately();
    // Only real conversational turns reach the model. systemAction bubbles
    // (end-of-intake save list) are things the UI said, not things the
    // advisor said or heard; errors never enter `messages` at all (ADR 0026).
    // One shared predicate owns this — see conversationalOnly() in
    // shared/types.ts. Implements: ADR 0028.
    const forWorker = conversationalOnly(next);
    chrome.runtime.sendMessage({
      type: "AI_CHAT",
      messages: forWorker,
      auditText: auditText ?? "",
      profile: profile ?? "",
      mode,
    });
  }

  function startOnboarding() {
    setShowWelcomeCard(false);
    setOnboardingMode(true);
    // Fresh intake: discard any stale queue from an aborted prior run
    // (e.g. the student closed the browser mid-intake before
    // complete_onboarding fired). RESET_ONBOARDING already handles the
    // Settings "Re-run onboarding" path — this covers the cold-start path.
    chrome.storage.local.remove("onboarding_save_queue");
    sendMessage("Hi! I'd like to get started.", "onboarding");
  }

  function skipOnboarding() {
    setShowWelcomeCard(false);
    // Discard any queued intake items — Skip means the student doesn't want
    // an intake at all, so a prior aborted queue shouldn't leak into a later
    // opt-in.
    chrome.storage.local.remove("onboarding_save_queue");
    chrome.runtime.sendMessage({ type: "SET_ONBOARDING_COMPLETED" });
  }

  // Mid-stream cancel. Pair of the inline "Stop" button that replaces Send
  // while loading. The worker's currentChatController aborts; the existing
  // abort path already broadcasts AI_DONE so loading flips back to false.
  function cancelStream() {
    chrome.runtime.sendMessage({ type: "CANCEL_AI_CHAT" });
  }

  // Re-dispatch the turn that just failed. The student's message is already
  // in `messages` — Retry must NOT append a new user turn, only clear the
  // error slot and send the same conversational history again. Implements:
  // ADR 0026 (the Notice's action slot is the recovery path).
  function retryTurn() {
    if (loading) return;
    setTurnError(null);
    setTurnNotice(null);
    setLoading(true);
    scrollToBottomImmediately();
    chrome.runtime.sendMessage({
      type: "AI_CHAT",
      messages: conversationalOnly(messages),
      auditText: auditText ?? "",
      profile: profile ?? "",
      mode: onboardingMode ? "onboarding" : "normal",
    });
  }

  // Dismiss the end-of-intake gate and open the input for normal chat. The
  // onboarding mode flag already flipped to false when ONBOARDING_SAVES_DONE
  // arrived, so the next user message routes through the normal prompt.
  // Conversation history is preserved — the student can scroll back and
  // re-read the intake and the saved-memories bubble.
  function continueToChat() {
    setShowContinueButton(false);
    setOnboardingFinalized(false);
    onboardingFinalizedRef.current = false;
    chrome.storage.session.set({ [SHOW_CONTINUE_KEY]: false });
  }

  return (
    <div className="flex flex-col h-full">

      {/* Panel status — one surface, two treatments (ADR 0024): the healthy
          path is a quiet 28px strip; anything with a severity renders as an
          ambient <Notice> instead. Never both. The no-audit notice waits for
          welcomeDecided so it doesn't flash while FirstRun (which contains
          the same instruction as step 2) is still deciding whether to show. */}
      {auditError ? (
        <div className="mx-3 mt-2 shrink-0">
          <Notice
            severity="error"
            title="Audit refresh failed"
            body={auditError}
            action={{ label: "Open DegreeWorks", href: DEGREEWORKS_URL }}
          />
        </div>
      ) : auditExpired ? (
        <div className="mx-3 mt-2 shrink-0">
          <Notice
            severity="warn"
            title="DegreeWorks session expired — log in again and the audit refreshes itself"
            action={{ label: "Open DegreeWorks", href: DEGREEWORKS_URL }}
          />
        </div>
      ) : auditText ? (
        <StatusStrip
          text={
            profileLoading
              ? "Building your student profile…"
              : catalogCount > 0
                ? `Audit loaded · ${catalogCount.toLocaleString()} courses in catalog`
                : "Audit loaded"
          }
          busy={loading || profileLoading}
        />
      ) : welcomeDecided && !showWelcomeCard ? (
        <div className="mx-3 mt-2 shrink-0">
          <Notice
            severity="info"
            title="No audit loaded — open DegreeWorks and it loads itself"
            action={{ label: "Open DegreeWorks", href: DEGREEWORKS_URL }}
          />
        </div>
      ) : null}

      {/* Messages — scrollContainerRef drives the user-lock scroll behavior.
          Wrapper is relative so the "↓ Jump to latest" button can sit
          absolute-positioned over the scroll area without being clipped. */}
      <div className="flex-1 relative overflow-hidden">
        {!isAtBottom && (
          <button
            onClick={scrollToBottomImmediately}
            aria-label="Jump to latest"
            className="absolute bottom-3 right-3 z-10 flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-fordham-maroon/90 hover:bg-fordham-maroon text-white text-xs font-medium shadow-md backdrop-blur-sm"
          >
            <span aria-hidden>↓</span>
            <span>Latest</span>
          </button>
        )}
      <div
        ref={scrollContainerRef}
        className="h-full overflow-y-auto p-3 space-y-3"
        role="log"
        // Muted while a turn streams: announcing every chunk (and every
        // rotating phrase) is SR spam. AI_DONE flips loading off and the
        // completed turn announces once. The sr-only "Advisor is thinking"
        // covers the gap. Implements: ADR 0024.
        aria-live={loading ? "off" : "polite"}
        aria-atomic="false"
        aria-label="Advisor conversation"
      >
        {/* Empty states wait for welcomeDecided — nothing paints until the
            onboarding round-trips resolve, killing the suggestions→FirstRun
            flash on a fresh install. Implements: ADR 0024. */}
        {messages.length === 0 && welcomeDecided && showWelcomeCard && (
          <FirstRun
            hasKey={hasKey}
            hasAudit={!!auditText}
            hasCatalog={catalogCount > 0}
            onOpenSettings={onOpenSettings}
            onStart={startOnboarding}
            onSkip={skipOnboarding}
          />
        )}

        {messages.length === 0 && welcomeDecided && !showWelcomeCard && (
          <div className="pt-4 animate-msg-in">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Ask anything about your degree requirements.
            </p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800 border-y border-gray-100 dark:border-gray-800">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="focus-ring block w-full text-left px-1 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:text-fordham-maroon dark:hover:text-fordham-maroon-ink active:bg-gray-50 dark:active:bg-gray-800/60 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <Message
            key={i}
            message={msg}
            firstName={firstName}
            advisorEmail={advisorEmail}
            advisorName={advisorName}
          />
        ))}

        {/* Turn-scoped system events (ADR 0026) — anchored under the turn
            that produced them, never inside `messages`. One slot each. */}
        {turnError && (
          <Notice
            severity="error"
            title="The advisor couldn't respond"
            body={turnError}
            action={{ label: "Retry", onClick: retryTurn }}
            onDismiss={() => setTurnError(null)}
          />
        )}
        {turnNotice && (
          <Notice
            severity="info"
            title={
              // System chrome, so no first person — "I" here would be the
              // advisor's voice leaking into our Notice. Implements: ADR 0026.
              turnNotice === "tool-cap"
                ? "The advisor hit its per-turn tool limit."
                : "The response was cut short."
            }
            action={{
              label: "Continue",
              onClick: () => {
                setTurnNotice(null);
                sendMessage("Continue");
              },
            }}
            onDismiss={() => setTurnNotice(null)}
          />
        )}

        {showContinueButton && (
          <div className="flex justify-center pt-2 pb-1">
            <button
              onClick={continueToChat}
              className="focus-ring px-4 py-2 rounded-full bg-fordham-maroon text-white text-sm font-medium hover:bg-fordham-maroon/90 active:scale-95 transition-all duration-200 ease-spring shadow-sm"
            >
              Continue to chat →
            </button>
          </div>
        )}

        {(() => {
          // The panel's ONE waiting indicator (ADR 0024): a single derived
          // phrase. If a tool call is awaiting its result, say what THAT tool
          // is doing (TOOL_PHRASES); otherwise the rotating thinking phrase
          // covers the pure-reasoning gap. Hidden the moment text streams —
          // the growing prose is its own indicator.
          if (!loading) return null;
          const last = messages[messages.length - 1];
          if (
            last?.role === "assistant" &&
            !last.systemAction &&
            last.content.trim() !== ""
          ) {
            return null;
          }
          const inFlight =
            last?.role === "assistant" && !last.systemAction
              ? (last.toolEvents ?? []).find(
                  (e) => e.courseCount === undefined && e.error === undefined
                )
              : undefined;
          const phrase = inFlight
            ? TOOL_PHRASES[inFlight.name] ?? thinkingPhrase
            : thinkingPhrase;
          return (
            <div className="animate-msg-in">
              <p
                aria-hidden
                className="text-[13px] italic text-gray-600 dark:text-gray-400"
              >
                {phrase}…
              </p>
              <span className="sr-only">Advisor is thinking</span>
            </div>
          );
        })()}
        <div ref={bottomRef} />
      </div>
      </div>

      {/* Single-slot memory-save toast — floats just above the input bar
          so it doesn't clutter the message stream. Auto-dismisses after 3s
          or when the next save replaces it. */}
      {/* Speaks the citation grammar (ADR 0024): tracked-caps verb, mono-ish
          quiet ink, maroon accent — not a green success pill from another
          design system. The saved text is the payload; give it the full
          width instead of truncating at 220px. */}
      {toast && (
        <div className="px-3 pb-1 shrink-0">
          <p
            key={toast.id}
            className="border-l-2 border-fordham-maroon dark:border-fordham-maroon-ink pl-2 py-0.5 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400 truncate animate-toast-pop"
          >
            <span className="uppercase tracking-wider font-semibold">Saved</span>
            {" · "}
            {toast.text}
          </p>
        </div>
      )}

      {/* Input — disabled while the Continue-to-chat gate is showing so the
          student reads the wrap-up + saved memories before the next turn. */}
      <div className="px-3 pb-3 pt-2 border-t border-gray-200/70 dark:border-gray-800 shrink-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md">
        {/* The iMessage composer contract (ADR 0031): a pill field with a
            circular action button anchored at the baseline. items-end keeps
            the circle at the bottom while the textarea grows. */}
        <div className="flex items-end gap-2">
          {/* field-sizing:content grows the box with the message up to ~6
              lines; Enter sends, Shift+Enter breaks the line — the messenger
              contract. Implements: ADR 0024. 18px radius = one bubble. */}
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder={
              showContinueButton ? "Press Continue to start chat…" : "Ask anything…"
            }
            disabled={loading || showContinueButton}
            aria-label="Message the advisor"
            className="focus-ring flex-1 px-3.5 py-[7px] rounded-[18px] border border-gray-300 dark:border-gray-700 bg-transparent text-sm leading-relaxed [field-sizing:content] max-h-36 resize-none disabled:opacity-50 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
          {loading ? (
            <button
              onClick={cancelStream}
              aria-label="Stop generating"
              className="focus-ring shrink-0 w-[34px] h-[34px] rounded-full bg-gray-700 dark:bg-gray-600 text-white hover:bg-gray-800 dark:hover:bg-gray-500 active:scale-90 transition-all duration-200 ease-spring inline-flex items-center justify-center"
            >
              <span aria-hidden className="block w-2.5 h-2.5 rounded-[2px] bg-white" />
            </button>
          ) : (
            <button
              onClick={() => sendMessage(input)}
              disabled={showContinueButton || !input.trim()}
              aria-label="Send message"
              className="focus-ring shrink-0 w-[34px] h-[34px] rounded-full bg-fordham-maroon text-white disabled:opacity-40 disabled:bg-gray-400 dark:disabled:bg-gray-600 hover:bg-opacity-90 active:scale-90 transition-all duration-200 ease-spring inline-flex items-center justify-center"
            >
              {/* Arrow-up glyph, drawn — no icon dependency. */}
              <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 12.5V3.5M8 3.5L3.75 7.75M8 3.5l4.25 4.25"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
