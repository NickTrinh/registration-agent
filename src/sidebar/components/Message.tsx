// Implements: ADR 0024 (the annotated worksheet, not a chat app)
//
// The advisor's answer is THE DOCUMENT: plain ink on the page, full column,
// no container — because at Chrome's 320px minimum a two-sided bubble leaves
// ~28 characters of measure and a markdown table has no chance. The student's
// turn is the query in the margin: it keeps a bubble, right-aligned, maroon.
// Alternating alignment distinguishes the speakers; avatars were 36px of a
// 320px column saying nothing.
//
// On wide panels the prose caps at 65ch — an unbounded 900px line is as
// unreadable as a 28-character one.

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConversationMessage } from "../../shared/types";
import Citation from "./Citation";
import OnboardingSavesBubble from "./OnboardingSavesBubble";

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

export default function Message({
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
  // AI prose — it's a UI event, not the model's voice.
  if (message.systemAction?.kind === "onboarding-saves") {
    return (
      <OnboardingSavesBubble
        items={message.systemAction.items}
        done={message.systemAction.done}
      />
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-msg-in">
        {/* iMessage bubble geometry: uniform 18px radius, no corner notch —
            the notch read as a speech-bubble affordance from an older chat
            idiom. origin-bottom-right so msg-in's scale settles from where
            the bubble was "sent". */}
        <div className="max-w-[85%] px-3.5 py-2 rounded-[18px] bg-fordham-maroon text-white text-[13px] leading-relaxed whitespace-pre-wrap origin-bottom-right">
          {message.content}
        </div>
      </div>
    );
  }

  const toolEvents = message.toolEvents ?? [];
  return (
    <div className="animate-msg-in">
      {toolEvents.length > 0 && (
        <div className="mb-1.5 space-y-0.5">
          {toolEvents.map((ev, idx) => (
            <Citation key={idx} event={ev} />
          ))}
        </div>
      )}
      {message.content.trim() !== "" && (
        <div className="max-w-[65ch] text-sm leading-relaxed text-gray-800 dark:text-gray-100">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-gray-50">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 my-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 my-2">{children}</ol>,
              li: ({ children }) => <li className="leading-snug">{children}</li>,
              code: ({ children }) => <code className="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
              pre: ({ children }) => <pre className="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-2 rounded-md text-xs font-mono overflow-x-auto my-2">{children}</pre>,
              // Headings demote to sized paragraphs — a full h1 inside a
              // narrow column shouts. Sizing keeps the hierarchy readable.
              h1: ({ children }) => <p className="font-semibold text-base mt-3 mb-1 first:mt-0">{children}</p>,
              h2: ({ children }) => <p className="font-semibold text-[15px] mt-3 mb-1 first:mt-0">{children}</p>,
              h3: ({ children }) => <p className="font-semibold text-[14px] mt-2 mb-1 first:mt-0">{children}</p>,
              hr: () => <hr className="my-3 border-gray-200 dark:border-gray-700" />,
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring rounded text-fordham-maroon dark:text-fordham-maroon-ink underline hover:opacity-80"
                >
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-gray-300 dark:border-gray-600 pl-3 my-2 text-gray-600 dark:text-gray-400">
                  {children}
                </blockquote>
              ),
              // Tables keep their own scroll container — the ONE place
              // horizontal scrolling is allowed in the panel.
              table: ({ children }) => (
                <div className="my-2 overflow-x-auto">
                  <table className="text-xs border-collapse">{children}</table>
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
        </div>
      )}
    </div>
  );
}
