import Link from "next/link";

export default function AuthCodeErrorPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <h1 className="text-xl font-semibold text-white">Sign-in failed</h1>
      <p className="max-w-sm text-sm text-foreground/60">
        We couldn&apos;t complete the Google sign-in. Please try again.
      </p>
      <Link
        href="/login"
        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-white transition hover:border-accent-primary"
      >
        Back to login
      </Link>
    </main>
  );
}
