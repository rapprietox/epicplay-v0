import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function PendingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <h1 className="text-xl font-semibold text-white">Almost there</h1>
      <p className="max-w-sm text-sm text-foreground/60">
        Your account ({user.email}) is signed in but hasn&apos;t been assigned
        to a team yet. Ask your coach to link your account.
      </p>
      <SignOutButton />
    </main>
  );
}
