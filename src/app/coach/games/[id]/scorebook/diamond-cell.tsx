import type { Database } from "@/lib/supabase/types";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];

// Standard scorebook diamond, viewed from above, home at the bottom --
// home -> 1st (right) -> 2nd (top) -> 3rd (left) -> home, same
// orientation any real paper scorebook uses.
const HOME = { x: 12, y: 22 };
const FIRST = { x: 21, y: 12 };
const SECOND = { x: 12, y: 2 };
const THIRD = { x: 3, y: 12 };

// Official scorebook PDF export batch: which base this at-bat's own
// plate appearance reached, 0-4 (4 = scored on this same play, HR
// only) -- see the page's own caption for why a later teammate's hit
// driving this runner home isn't reflected back on this cell.
function baseReached(ab: AtBat): 0 | 1 | 2 | 3 | 4 {
  if (ab.is_out) return 0;
  switch (ab.result) {
    case "single":
    case "walk":
    case "intentional_walk":
    case "hbp":
    case "error":
    case "fc":
    case "dropped_third_strike_safe":
      return 1;
    case "double":
    case "ground_rule_double":
      return 2;
    case "triple":
      return 3;
    case "hr":
      return 4;
    default:
      return 0;
  }
}

export function DiamondCell({ atBat, notation }: { atBat: AtBat; notation: string }) {
  const base = baseReached(atBat);

  return (
    <div className="flex flex-col items-center leading-none">
      <svg width="22" height="22" viewBox="0 0 24 24">
        <polygon points={`${HOME.x},${HOME.y} ${FIRST.x},${FIRST.y} ${SECOND.x},${SECOND.y} ${THIRD.x},${THIRD.y}`} fill="none" stroke="#00000030" strokeWidth="0.75" />
        {base >= 1 && <line x1={HOME.x} y1={HOME.y} x2={FIRST.x} y2={FIRST.y} stroke="black" strokeWidth="1.5" />}
        {base >= 2 && <line x1={FIRST.x} y1={FIRST.y} x2={SECOND.x} y2={SECOND.y} stroke="black" strokeWidth="1.5" />}
        {base >= 3 && <line x1={SECOND.x} y1={SECOND.y} x2={THIRD.x} y2={THIRD.y} stroke="black" strokeWidth="1.5" />}
        {base === 4 && <circle cx={HOME.x} cy={HOME.y} r="2.2" fill="none" stroke="black" strokeWidth="1.2" />}
        {atBat.is_out && (
          <>
            <line x1="3" y1="3" x2="21" y2="21" stroke="black" strokeWidth="1.1" />
            <line x1="21" y1="3" x2="3" y2="21" stroke="black" strokeWidth="1.1" />
          </>
        )}
      </svg>
      <span className="whitespace-nowrap font-mono text-[8px]">{notation}</span>
    </div>
  );
}
