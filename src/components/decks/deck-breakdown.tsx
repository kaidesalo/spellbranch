import { ChevronDown } from "lucide-react";
import { BENCHMARK_GROUPS } from "@/lib/deck-breakdown";
import type { BenchmarkScore, DeckBreakdown, Letter } from "@/lib/deck-breakdown";

/**
 * One line for the closed dropdown. The analysis itself is unchanged.
 * Bracket is omitted outside Commander. A short list and an oversized list
 * each get their own phrase instead of a score.
 */
export function breakdownSummaryLine(breakdown: DeckBreakdown): string {
  if (breakdown.status === "skipped") return "Deck breakdown · too large to analyze";
  if (breakdown.status !== "ready" || breakdown.score === null) return "Deck breakdown · not enough cards";
  const parts = ["Deck breakdown", `List weight ${breakdown.score}`];
  if (breakdown.bracket) parts.push(`Bracket ${breakdown.bracket.value}`);
  if (breakdown.archetype) parts.push(breakdown.archetype);
  return parts.join(" · ");
}

/**
 * Deck breakdown for a list the viewer can already see. The numbers come
 * from analyzeDeck. This component does not fetch or store anything.
 * Closed until the reader opens it, so the deck page stays the list.
 */
export function DeckBreakdownPanel({ breakdown }: { breakdown: DeckBreakdown }) {
  const summary = breakdownSummaryLine(breakdown);
  return (
    <details
      className="mt-4 min-w-0 rounded-2xl border border-border/80 bg-card/70 [&[open]_summary_svg]:rotate-180"
      data-testid="deck-breakdown"
      data-status={breakdown.status}
    >
      <summary
        data-testid="deck-breakdown-summary"
        className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <h2 id="deck-breakdown-heading" className="min-w-0 flex-1 break-words text-base font-semibold">
          {summary}
        </h2>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-[rotate] duration-200" />
      </summary>
      <div className="min-w-0 space-y-4 border-t border-border/70 px-3 py-4 sm:px-4">
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          This is a fixed set of rules on the cards in the list. It can miss unusual wording, combos of
          more than two cards, and cards whose text has changed. It is a note about the list, not a judgment
          of the player.
        </p>
        {breakdown.status === "ready" && breakdown.overview && breakdown.primer && breakdown.weaknesses ? (
          <>
            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
              <ScoreCard breakdown={breakdown} />
              <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-5" aria-labelledby="breakdown-overview-heading">
                <h3 id="breakdown-overview-heading" className="text-base font-semibold">
                  Overview
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/90">{breakdown.overview}</p>
              </section>
            </div>
            <Primer primer={breakdown.primer} />
            <Weaknesses weaknesses={breakdown.weaknesses} />
            <KeyCards cards={breakdown.keyCards} />
            <Benchmarks rows={breakdown.benchmarks} />
            <HowToRead />
          </>
        ) : (
          <p
            data-testid={breakdown.status === "skipped" ? "deck-breakdown-skipped" : "deck-breakdown-empty"}
            className="max-w-3xl text-sm leading-relaxed text-muted-foreground"
          >
            {breakdown.emptyMessage}
          </p>
        )}
      </div>
    </details>
  );
}

function ScoreCard({ breakdown }: { breakdown: DeckBreakdown }) {
  const score = breakdown.score ?? 0;
  return (
    <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-5" aria-labelledby="list-weight-heading">
      <h3 id="list-weight-heading" className="label-caps text-muted-foreground">
        List weight
      </h3>
      <p
        data-testid="deck-breakdown-score"
        className="mt-1 text-5xl font-semibold tabular-nums text-primary"
        aria-label={`List weight ${score} of ${breakdown.maxScore}`}
      >
        {score}
      </p>
      <p className="text-sm tabular-nums text-muted-foreground">of {breakdown.maxScore}</p>
      {breakdown.bracket ? (
        <p data-testid="deck-breakdown-bracket" className="mt-3 text-sm font-medium">
          Bracket {breakdown.bracket.value} · {breakdown.bracket.name}
        </p>
      ) : (
        <p data-testid="deck-breakdown-bracket" className="mt-3 text-sm font-medium">
          No Commander bracket
        </p>
      )}
      {breakdown.archetype && (
        <p data-testid="deck-breakdown-archetype" className="text-sm text-muted-foreground">
          {breakdown.archetype}
        </p>
      )}
      {breakdown.speed && <p className="mt-3 text-sm leading-relaxed text-foreground/90">{breakdown.speed}</p>}
      {breakdown.bracket && breakdown.bracket.reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
          {breakdown.bracket.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Primer({ primer }: { primer: NonNullable<DeckBreakdown["primer"]> }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-5" aria-labelledby="breakdown-primer-heading">
      <h3 id="breakdown-primer-heading" className="text-base font-semibold">
        Primer
      </h3>
      <h4 className="mt-3 text-sm font-semibold">Core strategy</h4>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
        {primer.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <h4 className="mt-4 text-sm font-semibold">Mulligan</h4>
      <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
        <li>
          <span className="font-medium">Keep: </span>
          {primer.keep}
        </li>
        <li>
          <span className="font-medium">Avoid: </span>
          {primer.avoid}
        </li>
      </ul>
      <h4 className="mt-4 text-sm font-semibold">Key tips</h4>
      {primer.tips.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No extra tip stood out from these rules.</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          {primer.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Weaknesses({ weaknesses }: { weaknesses: NonNullable<DeckBreakdown["weaknesses"]> }) {
  const bands = [
    { id: "critical", label: "Critical", items: weaknesses.critical },
    { id: "moderate", label: "Moderate", items: weaknesses.moderate },
    { id: "minor", label: "Minor", items: weaknesses.minor },
  ] as const;
  return (
    <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-5" aria-labelledby="breakdown-weaknesses-heading">
      <h3 id="breakdown-weaknesses-heading" className="text-base font-semibold">
        Weaknesses
      </h3>
      <div className="mt-3 grid min-w-0 gap-4 md:grid-cols-3">
        {bands.map((band) => (
          <div key={band.id} data-testid={`weakness-${band.id}`} className="min-w-0">
            <h4 className="text-sm font-semibold">{band.label}</h4>
            {band.items.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nothing in this band stood out.</p>
            ) : (
              <ul className="mt-1 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                {band.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function KeyCards({ cards }: { cards: DeckBreakdown["keyCards"] }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-5" aria-labelledby="breakdown-key-cards-heading">
      <h3 id="breakdown-key-cards-heading" className="text-base font-semibold">
        Key cards
      </h3>
      {cards.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No card stood out under these rules.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {cards.map((card) => (
            <li key={card.cardName} className="min-w-0 text-sm leading-relaxed">
              <span className="font-medium break-words">{card.cardName}</span>
              <span className="text-muted-foreground">. {card.role}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Benchmarks({ rows }: { rows: BenchmarkScore[] }) {
  const groups = BENCHMARK_GROUPS.map((group) => ({
    ...group,
    rows: rows.filter((row) => row.group === group.id),
  })).filter((group) => group.rows.length > 0);
  return (
    <section className="min-w-0" data-testid="deck-breakdown-benchmarks" aria-labelledby="breakdown-benchmarks-heading">
      <h3 id="breakdown-benchmarks-heading" className="text-base font-semibold">
        Benchmarks
      </h3>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Each row is one rule. The letter is the tier, and the points are what that tier adds to list weight.
      </p>
      <div className="mt-3 grid min-w-0 gap-4 lg:grid-cols-2">
        {groups.map((group) => (
          <section key={group.id} className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-3 sm:p-4" aria-labelledby={`benchmark-group-${group.id}`}>
            <h4 id={`benchmark-group-${group.id}`} className="text-sm font-semibold">
              {group.label}
            </h4>
            <ul className="mt-2 space-y-2">
              {group.rows.map((row) => (
                <li
                  key={row.id}
                  data-testid={`benchmark-${row.id}`}
                  data-letter={row.letter}
                  data-points={row.points}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/80 bg-background/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{row.label}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{row.reading}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={letterClass(row.letter)}>{row.letter}</span>
                    <span className="w-14 text-right text-sm tabular-nums text-muted-foreground">
                      {row.points} {row.points === 1 ? "pt" : "pts"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

function letterClass(letter: Letter): string {
  const base = "inline-flex size-7 items-center justify-center rounded-md text-sm font-semibold";
  if (letter === "S" || letter === "A") return `${base} bg-primary text-primary-foreground`;
  if (letter === "B" || letter === "C") return `${base} bg-secondary text-secondary-foreground`;
  return `${base} border border-border text-muted-foreground`;
}

function HowToRead() {
  return (
    <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-5" aria-labelledby="breakdown-howto-heading">
      <h3 id="breakdown-howto-heading" className="text-base font-semibold">
        How to read list weight
      </h3>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed">
        List weight adds the benchmark points. It describes this list on its own: mana, tutors, pressure,
        answers, and recovery. A higher number is a heavier list on paper. It is not a win rate.
      </p>
      <ul className="mt-3 max-w-3xl list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90">
        <li>A table often aims at the heaviest list. A quieter list can still win a game nobody expected.</li>
        <li>When lists are unknown, answers get pointed at the wrong cards, and the result says little about this number.</li>
        <li>
          Brackets 1 and 5 are about what the players are trying to do. The bracket here is only the floor the
          published Commander card rules require.
        </li>
      </ul>
    </section>
  );
}
