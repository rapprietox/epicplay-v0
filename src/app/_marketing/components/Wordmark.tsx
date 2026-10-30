// Reproduces the hero's own wordmark (glowing green ⚾, gold glowing
// EPICPLAY, green glowing AI, same fonts) at any size, for reuse in
// Nav/Footer/FinalCTA. The hero's own markup (.hero-wordmark/
// .wordmark-ball/.wordmark-epic/.wordmark-ai in marketing.css) is left
// completely untouched -- this is a separate component with its own
// inline styles, calibrated to match those fixed CSS classes' values
// at their own smallest size (52px, the bottom of the hero's
// `clamp(52px, 10vw, 112px)`) so every ratio below (ball size, glow
// blur radii) is copied from the hero's real numbers, not guessed:
// ball drop-shadow 16px at a 52px ball -> 16/52; text-shadow 20px/60px
// at a 52px glyph -> 20/52 and 60/52.
interface WordmarkProps {
  size?: number;
  className?: string;
}

export function Wordmark({ size = 28, className }: WordmarkProps) {
  const ballBlur = size * (16 / 52);
  const textBlurNear = size * (20 / 52);
  const textBlurFar = size * (60 / 52);

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: size * (12 / 52), lineHeight: 1 }}
    >
      <span style={{ fontSize: size, filter: `drop-shadow(0 0 ${ballBlur}px #2ecc71)` }}>⚾</span>
      <span
        style={{
          fontFamily: '"Barlow Condensed", sans-serif',
          fontWeight: 900,
          fontSize: size,
          color: "#f0c060",
          textShadow: `0 0 ${textBlurNear}px #f0c060, 0 0 ${textBlurFar}px rgba(240, 192, 96, 0.3)`,
          letterSpacing: "-0.01em",
        }}
      >
        EPICPLAY
      </span>
      <span
        style={{
          fontFamily: '"Barlow Condensed", sans-serif',
          fontWeight: 900,
          fontSize: size,
          color: "#2ecc71",
          textShadow: `0 0 ${textBlurNear}px #2ecc71, 0 0 ${textBlurFar}px rgba(46, 204, 113, 0.3)`,
          letterSpacing: "-0.01em",
        }}
      >
        AI
      </span>
    </span>
  );
}
