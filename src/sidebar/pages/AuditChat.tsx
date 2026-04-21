import { useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ConversationMessage,
  ToolEvent,
  SystemActionItem,
  MemoryType,
} from "../../shared/types";

const SUGGESTIONS = [
  "What do I still need to graduate?",
  "What core requirements am I missing?",
  "What electives can I take next semester?",
  "How many credits do I have left?",
];

// Rotating thinking phrases — shown with a spinner while Sonnet is reasoning
// between the user's message and the first visible output (text stream or
// tool chip). Mixes silly-whimsical with Fordham-domain flavor so it reads as
// characterful without looking unserious.
const THINKING_PHRASES = [
  "Pondering",
  "Scheming",
  "Cogitating",
  "Consulting the audit",
  "Flipping through requirements",
  "Squinting at course codes",
  "Deliberating",
  "Noodling",
  "Ruminating",
  "Cross-checking blocks",
  "Wrangling credits",
  "Thinking",
  "Cracking the knuckles",
  "Channeling your advisor",
];

function describeSearch(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (input.course_code) parts.push(String(input.course_code));
  if (input.subject) parts.push(String(input.subject));
  if (input.min_number && input.max_number)
    parts.push(`${input.min_number}–${input.max_number}`);
  else if (input.min_number) parts.push(`≥${input.min_number}`);
  else if (input.max_number) parts.push(`≤${input.max_number}`);
  if (input.keyword) parts.push(`"${input.keyword}"`);
  if (Array.isArray(input.days) && input.days.length > 0)
    parts.push(input.days.join(""));
  if (Array.isArray(input.attributes) && input.attributes.length > 0)
    parts.push(input.attributes.map((a) => String(a)).join("+"));
  if (input.has_seats) parts.push("open seats");
  return parts.length > 0 ? parts.join(" · ") : "catalog";
}

// Substitute privacy placeholders emitted by the PII-free audit renderer.
// The audit text sent to Anthropic contains [NAME], [ADVISOR], and
// [ADVISOR_EMAIL] instead of identifying fields, and Claude is told to echo
// those tokens verbatim. We swap them back here at render time so the chat
// feels personal without identifying data ever leaving the extension.
//
// Fallbacks:
//   [NAME] → "you" if the first name isn't available.
//   [ADVISOR] → "your advisor" if the advisor name wasn't on the audit.
//   [ADVISOR_EMAIL] → "advisor email not provided" desync fallback.
// All three real values live in chrome.storage.local (studentFirstName,
// studentAdvisorName, studentAdvisorEmail) and are populated only by the
// service worker's refreshAudit path — client-side, never sent outbound.
function personalize(
  text: string,
  firstName: string | null,
  advisorEmail: string | null,
  advisorName: string | null
): string {
  return text
    .replaceAll("[NAME]", firstName ?? "you")
    .replaceAll("[ADVISOR]", advisorName ?? "your advisor")
    .replaceAll("[ADVISOR_EMAIL]", advisorEmail ?? "advisor email not provided");
}

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

export default function AuditChat() {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

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
  const [toast, setToast] = useState<{ id: number; emoji: string; text: string } | null>(null);
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
        });
      });
    });
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
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: `Error: ${message.error}`,
            timestamp: new Date().toISOString(),
          }]);
          setLoading(false);
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
          const emoji = message.kind === "promoted" ? "⬆️" : "💾";
          toastCounter.current += 1;
          setToast({ id: toastCounter.current, emoji, text: desc });
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
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    // User is actively starting a new exchange — they should see their own
    // message and the incoming reply. Release any scroll-up lock so the
    // response auto-scrolls into view.
    scrollToBottomImmediately();
    // systemAction bubbles are UI-only (e.g. the end-of-intake save list) —
    // strip them before sending history to the model so they don't show up
    // as empty assistant turns in the conversation context.
    const forWorker = next.filter((m) => !m.systemAction);
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

      {/* Status bar */}
      <StatusBar
        auditText={auditText}
        auditError={auditError}
        profile={profile}
        profileLoading={profileLoading}
      />

      {auditExpired && (
        <div className="mx-3 mt-2 p-3 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900">
          <p className="font-semibold mb-1">DegreeWorks session expired</p>
          <p className="mb-2">
            Your Fordham session timed out. Open DegreeWorks and log in again,
            then come back — the audit will refresh automatically.
          </p>
          <a
            href="https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31"
            target="_blank"
            rel="noreferrer"
            className="inline-block px-2 py-1 rounded bg-fordham-maroon text-white font-medium hover:bg-fordham-maroon/90"
          >
            Open DegreeWorks →
          </a>
        </div>
      )}

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
        aria-live="polite"
        aria-atomic="false"
        aria-label="Advisor conversation"
      >
        {messages.length === 0 && showWelcomeCard && (
          <div className="pt-4">
            <div className="rounded-xl border border-fordham-maroon/30 bg-fordham-maroon/5 p-4">
              <p className="text-base font-semibold text-fordham-maroon mb-2">
                Let's get to know each other
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                Before I start recommending courses, I'd like to ask a few quick
                questions about what you're interested in, what you're aiming at,
                and anything that shapes your schedule. Takes about 5 minutes,
                and every answer makes future suggestions fit you better.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={startOnboarding}
                  disabled={!auditText}
                  className="flex-1 px-3 py-2 rounded-lg bg-fordham-maroon text-white text-sm font-medium hover:bg-fordham-maroon/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {auditText ? "Let's get started" : "Waiting for audit…"}
                </button>
                <button
                  onClick={skipOnboarding}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:bg-gray-800"
                >
                  Skip for now
                </button>
              </div>
            </div>
          </div>
        )}

        {messages.length === 0 && !showWelcomeCard && (
          <div className="pt-4">
            <p className="text-center text-sm text-gray-500 dark:text-gray-400 mb-4">
              Ask anything about your degree requirements.
            </p>
            <div className="grid grid-cols-1 gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-left px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-800 hover:border-fordham-maroon transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            firstName={firstName}
            advisorEmail={advisorEmail}
            advisorName={advisorName}
          />
        ))}

        {showContinueButton && (
          <div className="flex justify-center pt-2 pb-1">
            <button
              onClick={continueToChat}
              className="px-4 py-2 rounded-lg bg-fordham-maroon text-white text-sm font-medium hover:bg-fordham-maroon/90 transition-colors shadow-sm"
            >
              Continue to chat →
            </button>
          </div>
        )}

        {(() => {
          // Show the spinner when loading and there's no visible output from
          // Sonnet yet. Two cases:
          //   1. Last message is the user's — Sonnet hasn't started emitting anything.
          //   2. Last message is an assistant bubble with empty content and all
          //      its tool events have completed — between tool rounds, waiting
          //      for next tool or first text token.
          if (!loading) return null;
          const last = messages[messages.length - 1];
          const isInitialWait = last?.role === "user";
          const isBetweenRounds =
            last?.role === "assistant" &&
            last.content.trim() === "" &&
            (last.toolEvents ?? []).every((e) => e.courseCount !== undefined);
          if (!isInitialWait && !isBetweenRounds) return null;
          return (
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-fordham-maroon flex items-center justify-center text-white text-xs shrink-0">AI</div>
              <div className="inline-flex items-center gap-2 bg-gray-200 dark:bg-gray-700 rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                <span
                  className="inline-block w-3 h-3 rounded-full border-2 border-fordham-maroon border-t-transparent animate-spin"
                  aria-hidden
                />
                <span className="italic">{thinkingPhrase}…</span>
              </div>
            </div>
          );
        })()}
        {loading && (
          <div className="flex items-center gap-1 px-3 py-1" aria-label="Generating" aria-live="polite">
            <span className="w-1.5 h-1.5 rounded-full bg-fordham-maroon animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-fordham-maroon animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-fordham-maroon animate-bounce [animation-delay:300ms]" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      </div>

      {/* Single-slot memory-save toast — floats just above the input bar
          so it doesn't clutter the message stream. Auto-dismisses after 3s
          or when the next save replaces it. */}
      {toast && (
        <div className="px-3 pb-1 shrink-0">
          <div
            key={toast.id}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/50 border border-green-300 dark:border-green-700 text-xs text-green-900 dark:text-green-100 shadow-sm animate-toast-pop"
          >
            <span>{toast.emoji}</span>
            <span className="font-medium">Memory saved:</span>
            <span className="truncate max-w-[220px]">{toast.text}</span>
          </div>
        </div>
      )}

      {/* Input — disabled while the Continue-to-chat gate is showing so the
          student reads the wrap-up + saved memories before the next turn. */}
      <div className="p-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
            placeholder={
              showContinueButton
                ? "Press Continue to start chat…"
                : "Ask about your requirements..."
            }
            disabled={loading || showContinueButton}
            aria-label="Message the advisor"
            className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:border-fordham-maroon disabled:opacity-50"
          />
          {loading ? (
            <button
              onClick={cancelStream}
              aria-label="Stop generating"
              className="px-4 py-2 bg-gray-700 dark:bg-gray-600 text-white rounded-xl text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-500 transition-colors inline-flex items-center gap-1.5"
            >
              <span
                aria-hidden
                className="inline-block w-2.5 h-2.5 rounded-[2px] bg-white"
              />
              Stop
            </button>
          ) : (
            <button
              onClick={() => sendMessage(input)}
              disabled={showContinueButton || !input.trim()}
              className="px-4 py-2 bg-fordham-maroon text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-opacity-90 transition-colors"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

function StatusBar({
  auditText,
  auditError,
  profile,
  profileLoading,
}: {
  auditText: string | null;
  auditError: string | null;
  profile: string | null;
  profileLoading: boolean;
}) {
  if (auditError) {
    return (
      <div className="mx-3 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
        <div className="font-medium mb-0.5">Audit refresh failed</div>
        <div className="opacity-90 mb-1">{auditError}</div>
        <div className="text-red-700">
          Your session may have expired — try re-opening{" "}
          <a
            href="https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31"
            target="_blank"
            rel="noreferrer"
            className="underline font-medium"
          >
            DegreeWorks
          </a>{" "}
          and logging in again.
        </div>
      </div>
    );
  }

  if (!auditText) {
    return (
      <div className="mx-3 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        No audit loaded. Visit your{" "}
        <a
          href="https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31"
          target="_blank"
          rel="noreferrer"
          className="underline font-medium"
        >
          DegreeWorks page
        </a>{" "}
        to load automatically.
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="mx-3 mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-center gap-2">
        <span className="animate-spin">⟳</span>
        Building your student profile…
      </div>
    );
  }

  if (profile) {
    // Extract just the first line for display (Name | Year | Major | Minor)
    const firstLine = profile.split("\n")[0];
    return (
      <div className="mx-3 mt-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
        <span className="font-medium">Ready</span> — {firstLine}
      </div>
    );
  }

  return (
    <div className="mx-3 mt-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
      Audit loaded — building profile…
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  firstName,
  advisorEmail,
  advisorName,
}: {
  message: ConversationMessage;
  firstName: string | null;
  advisorEmail: string | null;
  advisorName: string | null;
}) {
  // System-action bubble (end-of-intake save batch). Rendered distinctly from
  // AI prose — it's a UI event, not the model's voice. Takes over the whole
  // row so it reads as a divider between the intake and the wrap-up.
  if (message.systemAction?.kind === "onboarding-saves") {
    return <OnboardingSavesBubble items={message.systemAction.items} done={message.systemAction.done} />;
  }
  const isUser = message.role === "user";
  const toolEvents = message.toolEvents;
  return (
    <div className={`flex gap-2 items-start ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isUser ? "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400" : "bg-fordham-maroon text-white"}`}>
        {isUser ? "You" : "AI"}
      </div>
      <div className="max-w-[85%] space-y-1">
        {!isUser && toolEvents && toolEvents.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {toolEvents.map((ev, idx) => {
              if (ev.name === "recall_memory") {
                const ids = Array.isArray(ev.input.ids) ? ev.input.ids : [];
                return (
                  <div key={idx} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-[10px] text-purple-900">
                    <span>🧠</span>
                    <span className="font-medium">Recalling {ids.length > 0 ? ids.map((id: unknown) => `#${id}`).join(", ") : "memories"}</span>
                    {ev.courseCount !== undefined ? (
                      <span className="text-purple-700">· {ev.courseCount} loaded</span>
                    ) : (
                      <span className="text-purple-600 italic">loading…</span>
                    )}
                  </div>
                );
              }
              if (ev.name === "save_memory") {
                const desc = typeof ev.input.description === "string" ? ev.input.description : "";
                return (
                  <div key={idx} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-[10px] text-green-900">
                    <span>💾</span>
                    <span className="font-medium">{desc || "Saving memory"}</span>
                    {ev.courseCount !== undefined ? (
                      <span className="text-green-700">· saved</span>
                    ) : (
                      <span className="text-green-600 italic">saving…</span>
                    )}
                  </div>
                );
              }
              if (ev.name === "forget_memory") {
                const ids = Array.isArray(ev.input.ids) ? ev.input.ids : [];
                return (
                  <div key={idx} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-[10px] text-red-900">
                    <span>🗑️</span>
                    <span className="font-medium">Forgetting {ids.length > 0 ? ids.map((id: unknown) => `#${id}`).join(", ") : "memory"}</span>
                    {ev.courseCount !== undefined ? (
                      <span className="text-red-700">· done</span>
                    ) : (
                      <span className="text-red-600 italic">removing…</span>
                    )}
                  </div>
                );
              }
              if (ev.name === "run_what_if") {
                const major = typeof ev.input.major === "string" ? ev.input.major : "";
                return (
                  <div key={idx} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[10px] text-blue-900">
                    <span>🔮</span>
                    <span className="font-medium">What-If{major ? `: ${major}` : ""}</span>
                    {ev.courseCount !== undefined ? (
                      <span className="text-blue-700">· done</span>
                    ) : (
                      <span className="text-blue-600 italic">running audit…</span>
                    )}
                  </div>
                );
              }
              // Default: search_catalog / list_attributes
              return (
                <div key={idx} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] text-amber-900">
                  <span>🔍</span>
                  <span className="font-medium">{describeSearch(ev.input)}</span>
                  {ev.courseCount !== undefined ? (
                    <span className="text-amber-700">· {ev.courseCount} results</span>
                  ) : (
                    <span className="text-amber-600 italic">searching…</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${isUser ? "bg-fordham-maroon text-white rounded-tr-sm whitespace-pre-wrap" : "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-sm"}`}>
          {isUser ? message.content : (
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 my-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 my-2">{children}</ol>,
              li: ({ children }) => <li className="leading-snug">{children}</li>,
              code: ({ children }) => <code className="bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-gray-100 px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
              pre: ({ children }) => <pre className="bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-gray-100 p-2 rounded-md text-xs font-mono overflow-x-auto my-2">{children}</pre>,
              h1: ({ children }) => <p className="font-semibold text-base mt-3 mb-1 first:mt-0">{children}</p>,
              h2: ({ children }) => <p className="font-semibold text-[15px] mt-3 mb-1 first:mt-0">{children}</p>,
              h3: ({ children }) => <p className="font-semibold text-[14px] mt-2 mb-1 first:mt-0">{children}</p>,
              hr: () => <hr className="my-3 border-gray-300" />,
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fordham-maroon underline hover:opacity-80"
                >
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-gray-300 pl-3 my-2 text-gray-600 dark:text-gray-400">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="my-2 overflow-x-auto">
                  <table className="text-[11px] border-collapse">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
              tbody: ({ children }) => <tbody>{children}</tbody>,
              tr: ({ children }) => <tr className="border-b border-gray-200 dark:border-gray-700">{children}</tr>,
              th: ({ children }) => (
                <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700 last:border-r-0">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-2 py-1 align-top border-r border-gray-200 dark:border-gray-700 last:border-r-0">
                  {children}
                </td>
              ),
            }}
          >
            {personalize(message.content, firstName, advisorEmail, advisorName)}
          </Markdown>
        )}
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding Saves Bubble ──────────────────────────────────────────────────
//
// Bubble A at end of intake: "Saving your profile…" with a per-row status.
// Rows start as pending (·) and flip to saved (✓) as ONBOARDING_SAVE_COMMITTED
// broadcasts arrive. Once the whole batch is done, the header loses the
// spinner. This is intentionally visually distinct from AI prose — it's a
// system event, not the model's voice. The wrap-up message (Bubble B) streams
// in afterward as a normal assistant bubble.

const SYSTEM_ACTION_TYPE_STYLE: Record<
  MemoryType,
  { label: string; bg: string; text: string }
> = {
  interest: { label: "INTEREST", bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-800 dark:text-purple-200" },
  constraint: { label: "CONSTRAINT", bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-800 dark:text-amber-200" },
  goal: { label: "GOAL", bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-800 dark:text-blue-200" },
  decision: { label: "DECISION", bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-800 dark:text-green-200" },
  note: { label: "NOTE", bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-700 dark:text-gray-300" },
};

function OnboardingSavesBubble({
  items,
  done,
}: {
  items: SystemActionItem[];
  done: boolean;
}) {
  const savedCount = items.filter((i) => i.status === "saved").length;
  return (
    <div className="rounded-xl border border-fordham-maroon/30 bg-fordham-maroon/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        {!done && (
          <span
            className="inline-block w-3 h-3 rounded-full border-2 border-fordham-maroon border-t-transparent animate-spin"
            aria-hidden
          />
        )}
        {done && <span aria-hidden>✓</span>}
        <p className="text-xs font-semibold text-fordham-maroon">
          {!done
            ? "Saving your profile…"
            : savedCount === 0
              ? "All set"
              : `Saved ${savedCount} ${savedCount === 1 ? "memory" : "memories"}`}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 italic">
          Nothing to save — we'll still get you set up.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => {
            const style = SYSTEM_ACTION_TYPE_STYLE[item.type] ?? SYSTEM_ACTION_TYPE_STYLE.note;
            return (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span
                  aria-hidden
                  className={
                    item.status === "saved"
                      ? "text-green-600 dark:text-green-400 mt-[1px]"
                      : "text-gray-400 dark:text-gray-600 mt-[1px]"
                  }
                >
                  {item.status === "saved" ? "✓" : "·"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`inline-block px-1.5 py-[1px] rounded text-[9px] font-semibold tracking-wide ${style.bg} ${style.text}`}
                    >
                      {style.label}
                    </span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium break-words">
                      {item.description}
                    </span>
                  </div>
                  {item.sourceQuote && (
                    <div className="text-[10px] italic text-gray-500 dark:text-gray-400 mt-0.5 break-words">
                      you said: "{item.sourceQuote}"
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
