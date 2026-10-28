import fs from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Marketing-homepage fix, take 2: the previous version had middleware
// NextResponse.rewrite "/" to public/marketing.html -- that didn't
// reliably work on Vercel's Edge middleware runtime. Reading the file
// directly in this Server Component (plain Node.js runtime, no rewrite
// involved at all) is the replacement.
//
// marketing.html is a full standalone document (doctype/html/head/body),
// built to also be servable as its own static file. It can't be dropped
// in whole here: this component's return value renders *inside* the
// shared <body> from src/app/layout.tsx, so a second nested <html>/<head>
// would be invalid HTML. Instead, strip the outer wrapper tags and inline
// everything between them -- the <style> block, the Google Fonts <link>
// tags, <nav>, <main>, and the trailing <script> -- as one block.
// <link rel="stylesheet">, <style>, and <script> all work the same
// whether they sit in <head> or <body>; that's standard browser
// behavior, not a hack. And because this is read and rendered by a
// Server Component (not injected into a live DOM via client-side
// innerHTML after the page has already loaded), the browser parses the
// <script> tag as part of the real initial HTML response and executes
// it normally, same as any other page's inline script.
const marketingHtmlPath = path.join(process.cwd(), "public", "marketing.html");

// Diagnostic logs -- confirming whether this file is actually present
// in the deployed Vercel function bundle (public/ assets aren't
// guaranteed to be included in the serverless function's own file set
// the way they're served as static assets). Remove once confirmed.
console.log("marketing.html exists:", fs.existsSync(marketingHtmlPath));

let marketingHtml = "";
try {
  marketingHtml = fs
    .readFileSync(marketingHtmlPath, "utf-8")
    .replace(/^<!doctype html>\s*/i, "")
    .replace(/<html[^>]*>\s*/i, "")
    .replace(/\s*<\/html>\s*$/i, "")
    .replace(/<head>\s*/i, "")
    .replace(/\s*<\/head>\s*/i, "")
    .replace(/<body>\s*/i, "")
    .replace(/\s*<\/body>\s*$/i, "")
    // Next's own <head> already provides a correct charset/viewport meta;
    // these two (left over from marketing.html's own head section) would
    // just be redundant, inert duplicates sitting inside <body>.
    .replace(/<meta charset="utf-8">\s*/i, "")
    .replace(/<meta name="viewport"[^>]*>\s*/i, "");
} catch (e) {
  console.error("marketing.html not found:", e);
  marketingHtml =
    '<h1 style="color:gold;font-family:sans-serif;text-align:center;padding:100px">EPICPLAY AI - Coming Soon</h1>';
}
console.log("marketing.html size:", marketingHtml.length);

// Anonymous visitors render the marketing site inline, below. Signed-in
// users fall through to the role-based redirect (mirrors ROLE_HOME in
// src/lib/supabase/middleware.ts), including the team_id gate -- a
// role-matching profile with no team yet still goes to /pending, same as
// every other route.
export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <title>EpicPlay AI War Room</title>
        <div id="marketing-page" dangerouslySetInnerHTML={{ __html: marketingHtml }} />
      </>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, team_id")
    .eq("id", user.id)
    .single();

  if (profile?.team_id) {
    if (profile.role === "coach") redirect("/coach");
    if (profile.role === "operator") redirect("/operator");
    if (profile.role === "player") redirect("/player/clubhouse");
  }
  redirect("/pending");
}
