import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { getOrCreateGameState } from "./actions";
import { OperatorConsole } from "./operator-console";

export default async function OperatorPage({
  searchParams,
}: {
  searchParams: { game?: string };
}) {
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
  if (!profile?.team_id || !["operator", "coach"].includes(profile.role)) redirect("/pending");

  const teamId = profile.team_id;

  const { data: activeGames } = searchParams.game
    ? await supabase.from("games").select("*").eq("team_id", teamId).eq("id", searchParams.game)
    : await supabase
        .from("games")
        .select("*")
        .eq("team_id", teamId)
        .eq("status", "active")
        .order("created_at", { ascending: false });

  const game = activeGames?.find((g) => g.status === "active") ?? null;

  if (!game) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-amber">Operator</p>
        <h1 className="font-heading text-2xl font-bold text-white">No active game</h1>
        <p className="max-w-sm text-sm text-foreground/60">
          Ask your coach to set up and start a game from the dashboard first.
        </p>
        <SignOutButton />
      </main>
    );
  }

  const [{ data: players }, { data: lineup }] = await Promise.all([
    supabase.from("players").select("*").eq("team_id", teamId).order("jersey_number"),
    supabase.from("lineup").select("*").eq("game_id", game.id),
  ]);

  const gameState = await getOrCreateGameState(game.id);

  let draftAtBat = null;
  if (gameState.current_at_bat_id) {
    const { data: atBat } = await supabase.from("at_bats").select("*").eq("id", gameState.current_at_bat_id).single();
    if (atBat) {
      const { data: pitches } = await supabase.from("pitches").select("*").eq("at_bat_id", atBat.id).order("pitch_number");
      draftAtBat = { ...atBat, pitches: pitches ?? [] };
    }
  }

  const { data: opponentPlayers } = game.opponent_id
    ? await supabase.from("opponent_players").select("*").eq("opponent_id", game.opponent_id)
    : { data: [] };

  return (
    <>
      <OperatorConsole
        game={game}
        players={players ?? []}
        lineup={lineup ?? []}
        initialGameState={gameState}
        draftAtBat={draftAtBat}
        opponentPlayers={opponentPlayers ?? []}
      />
      <div className="fixed left-3 top-3 z-20">
        <Link href="/coach" className="text-xs text-foreground/30 hover:text-foreground/60">
          ← dashboard
        </Link>
      </div>
    </>
  );
}
