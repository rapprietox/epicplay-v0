import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatGameDate } from "@/lib/dates";
import type { PlayerPositionCalibration } from "@/lib/supabase/types";
import { LineupBuilder } from "./lineup-builder";
import { OpponentPhotoImport } from "./opponent-photo-import";

export default async function GameSetupPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id || profile.role !== "coach") redirect("/pending");

  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!game) notFound();

  const [{ data: players }, { data: lineup }, { data: fieldPositionsRow }] = await Promise.all([
    supabase.from("players").select("*").eq("team_id", profile.team_id).order("jersey_number"),
    supabase.from("lineup").select("*").eq("game_id", game.id),
    // Change 2 (calibrate-field-tabs batch): drives where a placed
    // player's avatar snaps to on the field diagram -- null (never
    // calibrated yet) is a real, expected state, handled by the builder
    // via a banner rather than a formula-based fallback (that fallback,
    // and the field_type '2d' calibration it used, no longer apply here
    // at all -- see nearestSavedPosition in lib/field-zones.ts).
    supabase.from("field_calibration").select("calibration_points").eq("team_id", profile.team_id).eq("field_type", "positions").maybeSingle(),
  ]);

  const { data: opponentPlayers } = game.opponent_id
    ? await supabase.from("opponent_players").select("*").eq("opponent_id", game.opponent_id)
    : { data: [] };

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <Link href="/coach" className="text-sm text-accent-primary hover:underline">
        &larr; Back to dashboard
      </Link>

      <header className="mt-4 border-b border-border pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-amber">
          Pre-Game Setup
        </p>
        <h1 className="font-heading mt-1 text-3xl font-bold text-white">
          vs {game.opponent_name}
        </h1>
        <p className="mt-1 text-sm text-foreground/60">
          {formatGameDate(game.game_date)}
          {game.game_time ? ` · ${game.game_time}` : ""} · <span className="capitalize">{game.home_away}</span>
        </p>
      </header>

      <div className="mx-auto mt-6 flex max-w-4xl flex-col gap-6">
        <section className="glossy rounded-lg border border-border bg-surface p-5">
          <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">
            Lineup
          </h2>
          {/* Fix 1 (print-lineup batch): the Print Lineup control moved
              into LineupBuilder itself -- it now needs to react to
              client-side save state (gated inactive until this game's
              lineup has actually been persisted), which a plain link
              rendered here, in the server component, can't do. */}
          <div className="mt-4">
            <LineupBuilder
              gameId={game.id}
              players={players ?? []}
              initialLineup={lineup ?? []}
              initialUmpireName={game.umpire_name}
              fieldPositionsCalibration={(fieldPositionsRow?.calibration_points as PlayerPositionCalibration | undefined) ?? null}
            />
          </div>
        </section>

        <OpponentPhotoImport
          gameId={game.id}
          opponentName={game.opponent_name}
          hasOpponent={!!game.opponent_id}
          existingPlayers={opponentPlayers ?? []}
        />
      </div>
    </main>
  );
}
