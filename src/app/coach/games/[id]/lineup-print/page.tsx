import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Caveat } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import { formatGameDate } from "@/lib/dates";
import { PrintButton } from "./print-button";

// Feature 3 (lineup-status batch): "font Caveat (Google Fonts, handwritten
// style)" -- imported locally to this route rather than added to the root
// layout's font list, since nothing else in the app uses it; next/font/
// google works the same way from any file, not only layout.tsx.
const caveat = Caveat({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-caveat" });

export default async function LineupPrintPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, team_id").eq("id", user.id).single();
  if (!profile?.team_id || profile.role !== "coach") redirect("/pending");

  const { data: game } = await supabase.from("games").select("*").eq("id", params.id).eq("team_id", profile.team_id).single();
  if (!game) notFound();

  const [{ data: team }, { data: season }, { data: lineup, error: lineupError }, { data: players }] = await Promise.all([
    supabase.from("teams").select("name").eq("id", profile.team_id).single(),
    game.season_id ? supabase.from("seasons").select("name, year").eq("id", game.season_id).single() : Promise.resolve({ data: null }),
    supabase.from("lineup").select("*").eq("game_id", game.id),
    supabase.from("players").select("id, name, jersey_number").eq("team_id", profile.team_id),
  ]);

  // Bug 2 debugging: a query error (RLS, bad filter, etc.) used to look
  // identical to "no lineup saved yet" -- both just fell through to an
  // empty array. Logged server-side (this is a Server Component) so it
  // shows up in the terminal running `next dev`/the deployment logs, and
  // surfaced on the page itself instead of silently rendering as if
  // nothing was wrong.
  if (lineupError) {
    console.error(`lineup-print: failed to fetch lineup for game ${game.id}:`, lineupError.message);
  }

  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const starting = (lineup ?? [])
    .filter((l) => l.status === "starting")
    .sort((a, b) => (a.batting_order ?? 0) - (b.batting_order ?? 0));
  // Feature 3: reserve and late_arrival are both "available on the bench
  // right now" (Feature 1's own distinction between them is just when they
  // checked in, not whether they're usable) -- the lineup card only asked
  // for one RESERVE list, so both statuses fold into it here.
  const reserve = (lineup ?? []).filter((l) => l.status === "reserve" || l.status === "late_arrival");
  const absent = (lineup ?? []).filter((l) => l.status === "absent");

  return (
    <main className={`${caveat.variable} min-h-screen bg-background px-6 py-8 print:bg-white print:px-0 print:py-0`}>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/coach/games/${game.id}/setup`} className="text-sm text-accent-primary hover:underline">
          &larr; Back to lineup setup
        </Link>
        <PrintButton />
      </div>

      {lineupError && (
        <p className="mx-auto mb-4 max-w-[800px] rounded-md border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-sm text-accent-red print:hidden">
          Couldn&apos;t load the lineup ({lineupError.message}). Try reloading, or check the server logs.
        </p>
      )}
      {!lineupError && (lineup ?? []).length === 0 && (
        <p className="mx-auto mb-4 max-w-[800px] rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-sm text-accent-amber print:hidden">
          No lineup set for this game -- go back to lineup setup, place at least 9 players, and Save before printing.
        </p>
      )}

      {/* Feature 3: the printable card itself -- deliberately light/
          white-background regardless of the app's own dark theme (see
          this batch's write-up): a physical printout of a dark card would
          burn ink for no reason and read poorly once printed, so this one
          page breaks from the design system's dark palette on purpose. */}
      <div className="lineup-card mx-auto max-w-[800px] rounded-lg border border-border bg-white p-8 text-black shadow-xl print:m-0 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-4 border-black pb-3">
          <div className="flex items-center gap-3">
            {/* Feature 3: no team logo exists anywhere in this schema (no
                storage bucket, no teams.logo_url column) -- a monogram
                badge stands in for it rather than fabricating an image
                source; see this batch's write-up. */}
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-black text-2xl font-bold">
              {(team?.name ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h1 className="font-[family-name:var(--font-caveat)] text-4xl font-bold leading-none">{team?.name ?? "Our Team"}</h1>
              <p className="font-[family-name:var(--font-caveat)] mt-1 text-2xl font-semibold leading-none">
                vs {game.opponent_name}
              </p>
            </div>
          </div>

          {/* Ad space -- 80x60mm, dashed border, placeholder text, per spec. */}
          <div className="flex h-[60mm] w-[80mm] shrink-0 flex-col items-center justify-center border border-dashed border-black/40 text-center text-[10px] text-black/40">
            <span>Your ad here</span>
            <span>— contact us —</span>
          </div>
        </header>

        <section className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {season && (
            <span>
              <strong>Season:</strong> {season.name} ({season.year})
            </span>
          )}
          <span>
            <strong>Date:</strong> {formatGameDate(game.game_date)}
            {game.game_time ? ` · ${game.game_time}` : ""}
          </span>
          <span className="capitalize">
            <strong>Home/Away:</strong> {game.home_away}
          </span>
        </section>

        <table className="mt-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="w-10 py-1.5">#</th>
              <th className="py-1.5">PLAYER NAME</th>
              <th className="w-16 py-1.5">POS</th>
              <th className="w-16 py-1.5">BAT</th>
            </tr>
          </thead>
          <tbody>
            {starting.map((l, i) => {
              const p = playerById.get(l.player_id);
              return (
                <tr key={l.player_id} className={i % 2 === 1 ? "bg-black/5" : ""}>
                  <td className="py-1.5">{l.batting_order}</td>
                  <td className="py-1.5">
                    #{p?.jersey_number ?? "—"} {p?.name ?? "Player"}
                  </td>
                  <td className="py-1.5">{l.position}</td>
                  <td className="py-1.5">{l.batting_order}</td>
                </tr>
              );
            })}
            {starting.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-black/40">
                  No lineup set yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="font-semibold uppercase tracking-wide text-black/60">Reserve</p>
            <ul className="mt-1">
              {reserve.map((l) => {
                const p = playerById.get(l.player_id);
                return (
                  <li key={l.player_id}>
                    #{p?.jersey_number ?? "—"} {p?.name ?? "Player"}
                  </li>
                );
              })}
              {reserve.length === 0 && <li className="text-black/30">—</li>}
            </ul>
          </div>
          <div>
            <p className="font-semibold uppercase tracking-wide text-black/60">Absent</p>
            <ul className="mt-1">
              {absent.map((l) => {
                const p = playerById.get(l.player_id);
                return (
                  <li key={l.player_id}>
                    #{p?.jersey_number ?? "—"} {p?.name ?? "Player"}
                  </li>
                );
              })}
              {absent.length === 0 && <li className="text-black/30">—</li>}
            </ul>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
          <div>
            <div className="border-b border-black pb-6" />
            <p className="mt-1">Umpire signature</p>
          </div>
          <div>
            <div className="border-b border-black pb-6" />
            <p className="mt-1">Coach signature</p>
          </div>
        </div>

        <p className="font-[family-name:var(--font-caveat)] mt-6 text-right text-lg font-semibold text-black/50">
          EpicPlay AI ⚾
        </p>
      </div>

      <style>{`
        @page {
          size: A4 portrait;
          margin: 20mm;
        }
        @media print {
          .lineup-card {
            page-break-inside: avoid;
          }
        }
      `}</style>
    </main>
  );
}
