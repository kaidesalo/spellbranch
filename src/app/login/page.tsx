import { AuthForm } from "@/components/auth/auth-form";
import { signInAction } from "@/lib/actions/auth";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const returning = typeof params.next === "string";
  const user = await getSessionUser();
  if (user) redirect(next);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-border/80 bg-card/80 p-6 shadow-sm backdrop-blur-sm sm:p-8">
        <h1 className="text-3xl font-semibold">Welcome back</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to continue building and comparing decks with friends.
        </p>
        {returning && next !== "/dashboard" && (
          <p className="mt-3 text-sm text-muted-foreground">
            After you sign in, you&apos;ll continue to {next}.
          </p>
        )}
        {params.error === "confirm" && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>
              That confirmation link is invalid or has expired. Try signing in, or sign up again.
            </AlertDescription>
          </Alert>
        )}
        <div className="mt-6">
          <AuthForm mode="signin" action={signInAction} next={next} />
        </div>
      </div>
    </div>
  );
}
