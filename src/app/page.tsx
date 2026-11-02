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
          <p className="font-heading text-5xl font-semibold tracking-tight text-primary sm:text-6xl md:text-7xl">
            Spellbranch
          </p>
          <h1 className="mt-4 max-w-xl font-heading text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
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
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(174,93,64,0.2),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(75,114,110,0.25),transparent_50%),linear-gradient(160deg,#574852_0%,#4b3d44_45%,#4d4539_100%)]" />
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(210,201,165,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(210,201,165,0.08)_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="absolute inset-x-8 top-10 bottom-10 flex flex-col justify-between text-[#d2c9a5]">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#d2c9a5]">
                Branch view
              </p>
              <p className="mt-2 font-heading text-3xl font-semibold">
                Main ↔ Weekend cuts
              </p>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-[#d2c9a5]/15 pb-2">
                <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#8caba1]" />+ Nature&apos;s Lore</span>
                <span>0 → 1</span>
              </div>
              <div className="flex items-center justify-between border-b border-[#d2c9a5]/15 pb-2">
                <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#c77b58]" />− Cultivate</span>
                <span>1 → 0</span>
              </div>
              <div className="flex items-center justify-between border-b border-[#d2c9a5]/15 pb-2">
                <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#b3a555]" />Sol Ring qty</span>
                <span>1 → 2</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#d1b187]">Rhystic Study</span>
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
              <h2 className="font-heading text-lg font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
