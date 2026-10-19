import { AuthForm } from "@/components/auth/auth-form";
import { signUpAction } from "@/lib/actions/auth";
import { getSessionUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-border/80 bg-card/80 p-6 shadow-sm backdrop-blur-sm sm:p-8">
        <h1 className="font-heading text-3xl font-semibold">Join Spellbranch</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create an account to build decks, add friends, and fork branches.
        </p>
        <div className="mt-6">
          <AuthForm mode="signup" action={signUpAction} />
        </div>
      </div>
    </div>
  );
}
