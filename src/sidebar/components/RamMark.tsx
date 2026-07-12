// The RamPlan logo mark (ADR 0035): a frontal ram head — swept spiral horns,
// narrow muzzle, two ears — reduced to three filled masses so it survives the
// 16px toolbar icon as readily as a hero lockup. `fill="currentColor"` means
// the glyph inherits whatever ink its container carries, so the header's
// maroon / maroon-ink theme swap themes the mark for free (no dark variant).
// The bundled woff2 wordmark sits beside it; this is the picture half of the
// lockup. The toolbar/manifest icon is the same head knocked out of a maroon
// badge (public/icons/icon{16,48,128}.png) — a self-contained square that
// reads on any browser chrome, where a bare glyph could vanish.
export function RamMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      {/* muzzle */}
      <path d="M16 10.8 C13.7 10.8 12.6 12.6 12.6 15.2 C12.6 18.8 13.9 22.7 16 24.7 C18.1 22.7 19.4 18.8 19.4 15.2 C19.4 12.6 18.3 10.8 16 10.8 Z" />
      {/* ears */}
      <path d="M12.4 14.4 C10.8 13.8 9.6 14.6 10 16.1 C10.3 17.2 11.5 17.7 12.7 17.2 Z" />
      <path d="M19.6 14.4 C21.2 13.8 22.4 14.6 22 16.1 C21.7 17.2 20.5 17.7 19.3 17.2 Z" />
      {/* spiral horns */}
      <path d="M12.6 12.2 C8.6 9.2 3.8 10.6 3.3 14.9 C2.9 18.3 5.4 20.7 8.5 19.7 C6.2 19.1 5.1 16.8 5.7 14.6 C6.3 12.3 9.3 11.4 12.5 13.9 Z" />
      <path d="M19.4 12.2 C23.4 9.2 28.2 10.6 28.7 14.9 C29.1 18.3 26.6 20.7 23.5 19.7 C25.8 19.1 26.9 16.8 26.3 14.6 C25.7 12.3 22.7 11.4 19.5 13.9 Z" />
    </svg>
  );
}
