import { AuthForm } from "@/components/auth/auth-form";
import { signInAction } from "@/lib/actions/auth";
import { getSessionUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-border/80 bg-card/80 p-6 shadow-sm backdrop-blur-sm sm:p-8">
        <h1 className="text-3xl font-semibold">Welcome back</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to continue building and comparing decks with friends.
        </p>
        {error === "confirm" && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>
              That confirmation link is invalid or has expired. Try signing in, or sign up again.
            </AlertDescription>
          </Alert>
        )}
        <div className="mt-6">
          <AuthForm mode="signin" action={signInAction} />
        </div>
      </div>
    </div>
  );
}
