// The RamPlan crest (ADR 0036): "Fordhawke," a mortarboard-capped ram head on a
// ringed collegiate badge — the brand's real logo, not typeset text. It supersedes
// 0035's monochrome `currentColor` glyph: a logo is a full-color island, so the
// crest carries its OWN warm palette (gold horns, cream field, brown ring) and does
// NOT theme-swap with the header ink. The wordmark beside it stays maroon /
// maroon.ink (the parent's text color); the mark holds constant.
//
// Two-tier logo, mirroring the two-tier TYPE system (0033):
//   - PRIMARY (this crest): header lockup + icon48 + icon128 — where the badge breathes.
//   - COMPACT (a bare, ring-less ram head): icon16 only — at 16px the rings eat the
//     pixel budget, so the toolbar drops them and lets the head fill the frame. That
//     compact form lives as a PNG (public/icons/icon16.png), not here.
// icon128 is the rich engraved reference art (raster) knocked onto the same badge;
// this vector is its simplified small-and-mid-size derivative. Engraved detail dies
// below ~48px — the 0035 law that still governs.
export function RamMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true">
      {/* badge: brown ring · thin gold ring · cream field */}
      <circle cx="16" cy="16" r="15.4" fill="#4A3120" />
      <circle cx="16" cy="16" r="14.1" fill="#C99A3A" />
      <circle cx="16" cy="16" r="13.2" fill="#F1E7D2" />
      <g transform="translate(16 16.3) scale(0.86) translate(-16 -16.3)">
        {/* spiral horns */}
        <path d="M12 10.2 C6.8 8 3.2 10 3.1 14.4 C3 18.4 5.9 20.6 9 19.3 C6.6 18.8 5.4 16.7 6.1 14.6 C6.9 12.2 9.8 11.4 12.4 13.5 Z" fill="#E0A32E" stroke="#4A3120" strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M20 10.2 C25.2 8 28.8 10 28.9 14.4 C29 18.4 26.1 20.6 23 19.3 C25.4 18.8 26.6 16.7 25.9 14.6 C25.1 12.2 22.2 11.4 19.6 13.5 Z" fill="#E0A32E" stroke="#4A3120" strokeWidth="0.9" strokeLinejoin="round" />
        {/* caprine face */}
        <path d="M11 9.8 C10.1 12.6 9.6 15 10.1 17.4 C10.6 19.8 12 22.2 13.4 23.8 C14.3 24.8 15.2 25.4 16 25.7 C16.8 25.4 17.7 24.8 18.6 23.8 C20 22.2 21.4 19.8 21.9 17.4 C22.4 15 21.9 12.6 21 9.8 Z" fill="#F2E8D2" stroke="#4A3120" strokeWidth="1" strokeLinejoin="round" />
        {/* ears */}
        <path d="M11 12.6 C9.5 12.4 8.7 13.2 9.2 14.5 C9.6 15.4 10.7 15.5 11.6 14.9 Z" fill="#F2E8D2" stroke="#4A3120" strokeWidth="0.8" strokeLinejoin="round" />
        <path d="M21 12.6 C22.5 12.4 23.3 13.2 22.8 14.5 C22.4 15.4 21.3 15.5 20.4 14.9 Z" fill="#F2E8D2" stroke="#4A3120" strokeWidth="0.8" strokeLinejoin="round" />
        {/* brow ridges (the sly read) */}
        <path d="M12.2 14.4 C13 14 14 14 14.8 14.5" stroke="#4A3120" strokeWidth="0.8" strokeLinecap="round" />
        <path d="M17.2 14.5 C18 14 19 14 19.8 14.4" stroke="#4A3120" strokeWidth="0.8" strokeLinecap="round" />
        {/* eyes */}
        <path d="M12.6 15.6 C13.3 15.2 14.2 15.5 14.4 16.4 C14 17 13.1 17 12.7 16.6 Z" fill="#4A3120" />
        <path d="M19.4 15.6 C18.7 15.2 17.8 15.5 17.6 16.4 C18 17 18.9 17 19.3 16.6 Z" fill="#4A3120" />
        {/* nostrils */}
        <circle cx="15.1" cy="21.4" r="0.5" fill="#4A3120" />
        <circle cx="16.9" cy="21.4" r="0.5" fill="#4A3120" />
        {/* mortarboard — gold rim so it survives a dark bar */}
        <path d="M11.5 8.8 L16 10.6 L20.5 8.8 L16 7 Z" fill="#4A3120" />
        <path d="M16 3 L26.2 6.9 L16 10.9 L5.8 6.9 Z" fill="#4A3120" stroke="#E0A32E" strokeWidth="0.5" strokeLinejoin="round" />
        <circle cx="16" cy="6.9" r="1" fill="#E0A32E" />
      </g>
    </svg>
  );
}
