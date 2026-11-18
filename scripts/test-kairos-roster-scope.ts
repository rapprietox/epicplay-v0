// Data-reliability batch. Regression test for the bug this branch fixes:
// KAIROS's roster stats line ("Jordan Blake: 47 AB") disagreeing with the
// coach dashboard's own numbers (real total: 67 AB) for the same player.
// Root cause (see kairos-actions.ts's own comments): an unpaginated
// at_bats fetch silently truncating at PostgREST's 1000-row default, not
// a season-scoping bug as it first looked.
//
// This calls computeKairosRosterBattingLines -- the real, exported
// function buildSystemPrompt itself calls to build KAIROS's roster line --
// against both the demo team and the Lions (a real team), and compares
// every player's line to an independently-fetched, explicitly-paginated
// computeBattingLines call (the same shape coach/page.tsx's dashboard
// uses). Any difference is a real regression, not a tolerance band --
// these two are supposed to be exactly the same numbers.
//
// Run: npx tsx --env-file=.env.local scripts/test-kairos-roster-scope.ts
import { createClient } from "@supabase/supabase-js";
import { computeKairosRosterBattingLines } from "../src/app/coach/kairos-actions";
import { computeBattingLines } from "../src/lib/stats";
import type { Database } from "../src/lib/supabase/types";

const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEAMS = [
  { name: "EpicPlay Demo Team (sample data)", id: "481b2742-3cec-49eb-8ebe-11ee222c2925" },
  { name: "Lions", id: "63111c5c-4af6-40af-91ad-671ff3ae8d75" },
];

// Explicitly paginated "ground truth" -- the same query shape
// coach/page.tsx's dashboard uses (every game, no season filter), fetched
// independently of computeKairosRosterBattingLines so this test can't
// pass just because both sides share a bug.
async function fetchDashboardBattingLines(teamId: string) {
  const { data: games } = await supabase.from("games").select("id").eq("team_id", teamId);
  const gameIds = (games ?? []).map((g) => g.id);
  if (gameIds.length === 0) return new Map();

  const atBats: Database["public"]["Tables"]["at_bats"]["Row"][] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("at_bats")
      .select("*")
      .in("game_id", gameIds)
      .eq("mode", "hitting")
      .not("confirmed_at", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`dashboard at_bats fetch failed: ${error.message}`);
    atBats.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const { data: stolenBases } = await supabase.from("stolen_bases").select("player_id").in("game_id", gameIds);
  return computeBattingLines(atBats, stolenBases ?? []);
}

async function main() {
  let anyDifference = false;

  for (const team of TEAMS) {
    console.log(`\n${"=".repeat(70)}\n${team.name}\n${"=".repeat(70)}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [kairosLines, dashboardLines] = await Promise.all([
      computeKairosRosterBattingLines(supabase as any, team.id),
      fetchDashboardBattingLines(team.id),
    ]);

    const { data: players } = await supabase.from("players").select("id, name").eq("team_id", team.id).order("name");

    let teamHadDifference = false;
    for (const p of players ?? []) {
      const k = kairosLines.get(p.id);
      const d = dashboardLines.get(p.id);
      const kAb = k?.ab ?? 0;
      const dAb = d?.ab ?? 0;
      const kH = k?.h ?? 0;
      const dH = d?.h ?? 0;
      const kAvg = k ? Number(k.avg.toFixed(4)) : 0;
      const dAvg = d ? Number(d.avg.toFixed(4)) : 0;

      const matches = kAb === dAb && kH === dH && kAvg === dAvg;
      if (!matches) {
        teamHadDifference = true;
        anyDifference = true;
        console.log(
          `  MISMATCH ${p.name}: KAIROS says AB=${kAb} H=${kH} AVG=${kAvg} -- dashboard says AB=${dAb} H=${dH} AVG=${dAvg}`
        );
      }
    }

    if (!teamHadDifference) {
      console.log(`  OK -- all ${players?.length ?? 0} players' KAIROS roster lines match the dashboard exactly.`);
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  if (anyDifference) {
    console.log("FAIL -- KAIROS's roster stats disagree with the dashboard for at least one player.");
    process.exit(1);
  } else {
    console.log("PASS -- KAIROS's roster stats agree with the dashboard for every player, both teams.");
  }
}

main().catch((e) => {
  console.error("TEST SCRIPT ERROR:", e);
  process.exit(1);
});
