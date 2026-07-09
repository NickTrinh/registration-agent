// Implements: ADR 0024 (the annotated worksheet, not a chat app)
// Implements: ADR 0032 (grey user bubble; data-turn scroll contract)
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
// [NAME]/[ADVISOR]/[ADVISOR_EMAIL] render-time substitution — extracted to
// its own module (ADR 0032) so the Settings profile card can share it.
import { personalize } from "../personalize";

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
      // data-turn="user" is the scroll contract (ADR 0032): AuditChat pins
      // the newest user turn to the top of the viewport on send, and this
      // attribute is what it finds. Rename it and scrolling silently dies.
      <div className="flex justify-end animate-msg-in" data-turn="user">
        {/* iMessage bubble geometry: uniform 18px radius, no corner notch —
            the notch read as a speech-bubble affordance from an older chat
            idiom. origin-bottom-right so msg-in's scale settles from where
            the bubble was "sent". Grey, not maroon (ADR 0032, amending 0024):
            in the Claude app the user's turn is a quiet quote to be answered,
            not the loudest object on the page — maroon stays an accent. */}
        <div className="max-w-[85%] px-3.5 py-2 rounded-[18px] bg-stone-200 text-stone-900 dark:bg-stone-800 dark:text-stone-100 text-[13px] leading-relaxed whitespace-pre-wrap origin-bottom-right">
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
        <div className="max-w-[65ch] text-sm leading-relaxed text-stone-800 dark:text-stone-100">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-stone-900 dark:text-stone-50">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 my-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 my-2">{children}</ol>,
              li: ({ children }) => <li className="leading-snug">{children}</li>,
              code: ({ children }) => <code className="bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
              pre: ({ children }) => <pre className="bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 p-2 rounded-md text-xs font-mono overflow-x-auto my-2">{children}</pre>,
              // Headings demote to sized paragraphs — a full h1 inside a
              // narrow column shouts. Sizing keeps the hierarchy readable.
              h1: ({ children }) => <p className="font-semibold text-base mt-3 mb-1 first:mt-0">{children}</p>,
              h2: ({ children }) => <p className="font-semibold text-[15px] mt-3 mb-1 first:mt-0">{children}</p>,
              h3: ({ children }) => <p className="font-semibold text-[14px] mt-2 mb-1 first:mt-0">{children}</p>,
              hr: () => <hr className="my-3 border-stone-200 dark:border-stone-700" />,
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
                <blockquote className="border-l-2 border-stone-300 dark:border-stone-600 pl-3 my-2 text-stone-600 dark:text-stone-400">
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
              thead: ({ children }) => <thead className="bg-stone-50 dark:bg-stone-800">{children}</thead>,
              tbody: ({ children }) => <tbody>{children}</tbody>,
              tr: ({ children }) => <tr className="border-b border-stone-200 dark:border-stone-700">{children}</tr>,
              th: ({ children }) => (
                <th className="px-2 py-1 text-left font-semibold text-stone-700 dark:text-stone-300 border-r border-stone-200 dark:border-stone-700 last:border-r-0">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-2 py-1 align-top border-r border-stone-200 dark:border-stone-700 last:border-r-0">
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
