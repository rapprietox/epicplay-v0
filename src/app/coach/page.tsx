import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { StadiumBackground } from "@/components/stadium-background";
import { RosterSection } from "./roster-section";
import { SeasonImportSection } from "./season-import-section";
import { NextGamePanel } from "./next-game-panel";
import { LeadersBoard } from "./leaders-board";
import { ScheduleTable } from "./schedule-table";
import { RealtimeRefresh } from "./realtime-refresh";
import { TeamAnalytics } from "./team-analytics";
import { zoneIndexFromCoords, resultCategory, type AtBatWithZone, type SprayDot } from "@/lib/heat-map";
import type { AtBatResult } from "@/lib/supabase/types";

export default async function CoachPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role, team_id")
    .eq("id", user.id)
    .single();

  if (!profile?.team_id) redirect("/pending");

  const teamId = profile.team_id;

  const [{ data: team }, { data: players }, { data: games }, { data: opponents }] = await Promise.all([
    supabase.from("teams").select("name").eq("id", teamId).single(),
    supabase.from("players").select("*").eq("team_id", teamId).order("jersey_number", { ascending: true }),
    supabase.from("games").select("*").eq("team_id", teamId),
    supabase.from("opponents").select("name").eq("team_id", teamId).order("name"),
  ]);

  const allGames = games ?? [];
  const gameIds = allGames.map((g) => g.id);
  const [{ data: atBats }, { data: stolenBases }] = gameIds.length
    ? await Promise.all([
        supabase.from("at_bats").select("*").in("game_id", gameIds).not("confirmed_at", "is", null),
        supabase.from("stolen_bases").select("*").in("game_id", gameIds),
      ])
    : [{ data: [] as never[] }, { data: [] as never[] }];
  const activeGame = allGames.find((g) => g.status === "active") ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const nextGame =
    [...allGames]
      .filter((g) => g.status === "setup" && g.game_date >= today)
      .sort((a, b) => a.game_date.localeCompare(b.game_date))[0] ?? null;

  const confirmedAtBats = atBats ?? [];
  const { data: teamPitches } = confirmedAtBats.length
    ? await supabase
        .from("pitches")
        .select("at_bat_id, pitch_number, zone_x, zone_y")
        .in(
          "at_bat_id",
          confirmedAtBats.map((ab) => ab.id)
        )
    : { data: [] };

  const lastZoneByAtBat = new Map<string, number | null>();
  for (const ab of confirmedAtBats) {
    const forThisAtBat = (teamPitches ?? []).filter((p) => p.at_bat_id === ab.id);
    const last = forThisAtBat.sort((a, b) => b.pitch_number - a.pitch_number)[0];
    lastZoneByAtBat.set(ab.id, last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null);
  }
  const gameById = new Map(allGames.map((g) => [g.id, g]));

  const teamZoneAtBats: AtBatWithZone[] = confirmedAtBats
    .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null && ab.mode === "hitting")
    .map((ab) => ({ result: ab.result, zoneIndex: lastZoneByAtBat.get(ab.id) ?? null }));

  const teamSprayDots: (SprayDot & { opponentName: string })[] = confirmedAtBats
    .filter(
      (ab): ab is typeof ab & { result: AtBatResult; field_x: number; field_y: number } =>
        ab.result !== null && ab.field_x !== null && ab.field_y !== null && ab.mode === "hitting"
    )
    .map((ab) => {
      const g = gameById.get(ab.game_id);
      return {
        x: ab.field_x,
        y: ab.field_y,
        category: resultCategory(ab.result),
        result: ab.result,
        inning: ab.inning,
        gameDate: g?.game_date ?? "",
        opponentName: g?.opponent_name ?? "Unknown",
        hitType: ab.hit_type,
      };
    });

  return (
    <main className="min-h-screen px-6 py-8">
      <StadiumBackground />
      <RealtimeRefresh teamId={teamId} />
      <header className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Coach</p>
          <h1 className="font-heading mt-1 text-3xl font-bold text-white">{team?.name ?? "Team"}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-foreground/50">
            {profile.full_name ?? profile.email}
          </span>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto mt-6 flex max-w-6xl flex-col gap-6">
        <NextGamePanel
          nextGame={nextGame}
          activeGame={activeGame}
          allGames={allGames}
          atBats={atBats ?? []}
          players={players ?? []}
        />

        <LeadersBoard players={players ?? []} atBats={atBats ?? []} stolenBases={stolenBases ?? []} games={allGames} />

        <ScheduleTable games={allGames} opponentNames={(opponents ?? []).map((o) => o.name)} />

        <TeamAnalytics
          zoneAtBats={teamZoneAtBats}
          sprayDots={teamSprayDots}
          opponentNames={(opponents ?? []).map((o) => o.name)}
          nextOpponentName={nextGame?.opponent_name ?? null}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RosterSection players={players ?? []} />
          <SeasonImportSection />
        </div>
      </div>
    </main>
  );
}
