// Fixed, full-viewport stadium photo behind a screen's content, with a
// dark overlay tuned to the app's own background token (#030A06 ==
// rgb(3, 10, 6), just at 82% opacity instead of 100%) so it reads as an
// extension of the existing dark theme, not a different backdrop dropped
// on top of it. z-index -1 (not DOM order) is what keeps it behind
// normal-flow content -- the screen using this must drop its own opaque
// `bg-*` class on its root element, or that root's own background paints
// over this and the photo never shows.
export function StadiumBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0"
      style={{
        zIndex: -1,
        backgroundImage: "url('/stadium-bg.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0" style={{ background: "rgba(3, 10, 6, 0.82)" }} />
    </div>
  );
}
