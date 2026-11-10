import Link from "next/link";
import { ArrowRight, GitBranch, GitCompareArrows, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="hero-glow absolute -left-24 top-10 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="hero-glow absolute -right-16 top-32 h-80 w-80 rounded-full bg-accent/25 blur-3xl" />
      </div>

      <section className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="animate-rise">
          <p className="font-heading text-6xl text-primary sm:text-7xl md:text-8xl">
            Spellbranch
          </p>
          <h1 className="mt-4 max-w-xl font-sans text-3xl font-light leading-snug tracking-normal text-foreground sm:text-4xl">
            Build decks with friends. Fork ideas. Compare every change.
          </h1>
          <p className="mt-4 max-w-lg text-lg text-muted-foreground">
            A social Magic deck builder where branches stay independent and
            game-night experiments never overwrite the original list.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 animate-rise-delay">
            <Button size="lg" render={<Link href="/signup" />}>
              Start building
              <ArrowRight data-icon="inline-end" />
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/login" />}>
              Sign in
            </Button>
          </div>
        </div>

        <div
          aria-hidden
          className="relative hidden min-h-[420px] overflow-hidden rounded-none lg:block animate-rise-delay-2"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(232,183,106,0.22),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(52,65,88,0.65),transparent_50%),linear-gradient(160deg,#1A2232_0%,#10141F_55%,#1A2232_100%)]" />
          <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(244,235,221,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(244,235,221,0.06)_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="absolute inset-x-8 top-10 bottom-10 flex flex-col justify-between text-[#F4EBDD]">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#F4EBDD]">
                Branch view
              </p>
              <p className="mt-2 font-heading text-3xl font-semibold">
                Main ↔ Weekend cuts
              </p>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-[#F4EBDD]/15 pb-2">
                <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#E8B76A]" />+ Nature&apos;s Lore</span>
                <span>0 → 1</span>
              </div>
              <div className="flex items-center justify-between border-b border-[#F4EBDD]/15 pb-2">
                <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#ABB7C9]" />− Cultivate</span>
                <span>1 → 0</span>
              </div>
              <div className="flex items-center justify-between border-b border-[#F4EBDD]/15 pb-2">
                <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#F4EBDD]" />Sol Ring qty</span>
                <span>1 → 2</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#ABB7C9]">Rhystic Study</span>
                <span>unchanged</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-t border-border/60 bg-card/40 py-16">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 sm:grid-cols-3">
          {[
            {
              icon: Users,
              title: "Play together",
              body: "Add friends, share decks privately or publicly, and leave comments on any branch.",
            },
            {
              icon: GitBranch,
              title: "Fork safely",
              body: "Spin off a branch to try cuts and swaps while the source list stays untouched.",
            },
            {
              icon: GitCompareArrows,
              title: "Compare clearly",
              body: "See adds, removes, replacements, and quantity changes side by side.",
            },
          ].map((item) => (
            <div key={item.title}>
              <item.icon className="mb-3 h-5 w-5 text-primary" aria-hidden />
              <h2 className="label-caps text-sm text-foreground">{item.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
