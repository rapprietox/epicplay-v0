"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Hidden shared-operator sign-in -- sign-in only, no sign-up, no
// "forgot password". Not linked from /login or anywhere on the
// marketing site; reached only by whoever has the direct URL.
export default function OperatorLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError("Wrong email or password.");
      setLoading(false);
      return;
    }

    // Full navigation (not router.push) so the existing role-based
    // redirect in src/lib/supabase/middleware.ts runs fresh against the
    // new session cookie and sends an operator straight to /operator.
    window.location.href = "/";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="glossy w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-2xl shadow-black/40">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">EpicPlay AI</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Operator Sign In</h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-foreground/70">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-white outline-none focus:border-accent-primary"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-foreground/70">
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-white outline-none focus:border-accent-primary"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-lg bg-accent-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-light disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {error && <p className="text-center text-sm text-accent-red">{error}</p>}
        </form>
      </div>
    </main>
  );
}
