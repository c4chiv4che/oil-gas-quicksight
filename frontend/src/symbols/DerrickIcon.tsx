/**
 * DerrickIcon — minimalist oil-derrick glyph, shared across displays.
 *
 * Strokes use currentColor so the consumer's CSS (color: var(--state-*))
 * repaints the whole tower. Not photorealistic by design — this is an
 * HMI symbol, not artwork.
 *
 * Extracted from Overview's WellCard so the Overview and the Well Pad
 * Detail's WellColumn render the SAME tower from one source of truth.
 * The intrinsic 56x72 size is the design default; pass a `className`
 * whose CSS sets `width`/`height` to scale it per display. Same pattern
 * we used for buildZones (theme) and formatMinutes (utils): one glyph,
 * no divergence.
 */
export function DerrickIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="56"
      height="72"
      viewBox="0 0 56 72"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Crown block at the top of the tower */}
      <rect x="22" y="4" width="12" height="6" />
      {/* Two outer legs (truss frame) */}
      <line x1="6" y1="64" x2="24" y2="10" />
      <line x1="50" y1="64" x2="32" y2="10" />
      {/* Horizontal cross beams */}
      <line x1="18" y1="28" x2="38" y2="28" />
      <line x1="14" y1="44" x2="42" y2="44" />
      <line x1="10" y1="60" x2="46" y2="60" />
      {/* Truss diagonals between cross beams */}
      <line x1="18" y1="28" x2="42" y2="44" />
      <line x1="38" y1="28" x2="14" y2="44" />
      <line x1="14" y1="44" x2="46" y2="60" />
      <line x1="42" y1="44" x2="10" y2="60" />
      {/* Ground line */}
      <line x1="2" y1="64" x2="54" y2="64" />
    </svg>
  );
}
