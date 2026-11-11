import { ColorPips } from "@/components/decks/deck-colors";
import {
  formatAverage,
  formatPips,
  formatUsd,
  type ColorStat,
  type CurveBucket,
  type DeckStats,
  type PipColor,
  type TypeStat,
} from "@/lib/deck-stats";

const PIP_LABEL: Record<PipColor, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

/**
 * Header stats, mana curve, color requirements, and type counts.
 * Mainboard only; the commander is included when the deck has one.
 */
export function DeckStatistics({
  stats,
  formatLabel,
  colors,
  countLabel,
  scryfallUnavailable,
  includesCommander,
}: {
  stats: DeckStats;
  formatLabel: string;
  colors: readonly string[] | null;
  countLabel: string;
  scryfallUnavailable: boolean;
  includesCommander: boolean;
}) {
  const identity = colors ?? stats.colors.filter((row) => row.color !== "C").map((row) => row.color);
  const averageNote = includesCommander
    ? "Average mana value of nonland cards, including the commander."
    : "Average mana value of nonland cards.";
  return (
    <section className="mt-4 min-w-0 space-y-4" data-testid="deck-stats" aria-labelledby="deck-stats-heading">
      <h2 id="deck-stats-heading" className="text-xl font-semibold">
        Stats
      </h2>
      <ul
        data-testid="deck-stats-bar"
        className="flex min-w-0 flex-wrap gap-2 text-sm"
        aria-label="Deck summary"
      >
        <StatChip label="Format" value={formatLabel} />
        <li className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1">
          <span className="text-muted-foreground">Colors</span>
          <ColorPips colors={identity} />
          <span className="sr-only">{identity.length ? identity.join(", ") : "Colorless"}</span>
        </li>
        <StatChip label="Cards" value={countLabel} />
        <StatChip label="Avg CMC" value={formatAverage(stats.averageCmc)} />
        <StatChip label="est." value={formatUsd(stats.priceUsd)} />
      </ul>
      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
        {averageNote}{" "}
        {scryfallUnavailable
          ? "Scryfall did not answer, so prices and mana sources are missing."
          : "est. is the sum of Scryfall prices for each chosen printing, using the foil price when a foil finish is tracked. Prices can be stale."}
        {stats.unpriced > 0 && stats.priceUsd !== null && !scryfallUnavailable
          ? ` ${stats.unpriced} ${stats.unpriced === 1 ? "card has" : "cards have"} no Scryfall price.`
          : ""}
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ManaCurve buckets={stats.curve} spellCount={stats.spellCount} />
        <ColorRequirements
          rows={stats.colors}
          totalPips={stats.totalPips}
          totalSources={stats.totalSources}
        />
      </div>
      <TypeBreakdown types={stats.types} />
    </section>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <li className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-medium tabular-nums text-foreground">{value}</span>
    </li>
  );
}

function ManaCurve({ buckets, spellCount }: { buckets: CurveBucket[]; spellCount: number }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const summary = buckets.map((bucket) => `${bucket.label} mana: ${bucket.count}`).join(", ");
  return (
    <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-3 sm:p-4" aria-labelledby="mana-curve-heading">
      <div className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
        <h3 id="mana-curve-heading" className="text-base font-semibold">
          Mana curve
        </h3>
        <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {spellCount} {spellCount === 1 ? "spell" : "spells"}
        </p>
      </div>
      <svg
        viewBox="0 0 320 148"
        role="img"
        aria-labelledby="mana-curve-heading mana-curve-desc"
        className="h-auto w-full"
      >
        <desc id="mana-curve-desc">
          Nonland spells by mana value. {summary}. Gold is creatures, gray is other spells.
        </desc>
        {buckets.map((bucket, index) => {
          const slot = 320 / buckets.length;
          const x = index * slot + slot * 0.18;
          const width = slot * 0.64;
          const creatureH = (bucket.creatures / max) * 96;
          const otherH = (bucket.other / max) * 96;
          const base = 112;
          return (
            <g key={bucket.label} data-testid={`curve-${bucket.label}`} data-count={bucket.count}>
              <rect
                x={x}
                y={base - creatureH - otherH}
                width={width}
                height={otherH}
                rx={2}
                className="fill-muted-foreground/70"
              />
              <rect
                x={x}
                y={base - creatureH}
                width={width}
                height={creatureH}
                rx={2}
                className="fill-primary"
              />
              {bucket.count > 0 && (
                <text
                  x={x + width / 2}
                  y={base - creatureH - otherH - 6}
                  textAnchor="middle"
                  className="fill-foreground text-[11px]"
                >
                  {bucket.count}
                </text>
              )}
              <text x={x + width / 2} y={136} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {bucket.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="sr-only">
        {buckets.map((bucket) => (
          <li key={bucket.label}>
            {bucket.label}: {bucket.count} spells, {bucket.creatures} creatures and {bucket.other} other spells
          </li>
        ))}
      </ul>
      <p className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-primary" aria-hidden /> Creatures
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-muted-foreground/70" aria-hidden /> Other spells
        </span>
      </p>
    </section>
  );
}

function ColorRequirements({
  rows,
  totalPips,
  totalSources,
}: {
  rows: ColorStat[];
  totalPips: number;
  totalSources: number;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-3 sm:p-4" aria-labelledby="color-requirements-heading">
      <h3 id="color-requirements-heading" className="text-base font-semibold">
        Color requirements
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Cost {formatPips(totalPips)} {totalPips === 1 ? "pip" : "pips"}
        <span aria-hidden> · </span>
        Production {totalSources} {totalSources === 1 ? "source" : "sources"}
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No colored costs or mana sources on the mainboard.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.color} className="min-w-0" data-testid={`color-stat-${row.color}`}>
              <p className="mb-1 flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <ColorPips colors={[row.color]} />
                {PIP_LABEL[row.color]}
              </p>
              <Meter label="Cost" amount={`${formatPips(row.pips)} ${row.pips === 1 ? "pip" : "pips"}`} share={row.pipShare} />
              <Meter
                label="Production"
                amount={`${row.sources} ${row.sources === 1 ? "source" : "sources"}`}
                share={row.sourceShare}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Hybrid pips are split evenly across their colors. A Phyrexian pip counts as its color, and {"{2/W}"} or{" "}
        {"{2/C}"} counts as that color. Generic mana and X are not pips. A card counts once for each color Scryfall
        says it can produce, when that color is in the deck color identity. Colorless sources are included. Sideboard
        and maybeboard cards are not counted.
      </p>
    </section>
  );
}

function Meter({ label, amount, share }: { label: string; amount: string; share: number }) {
  return (
    <div className="mt-1 min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 break-words">
          {label} {amount}
        </span>
        <span className="shrink-0 tabular-nums">{share}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/50" aria-hidden>
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
        />
      </div>
    </div>
  );
}

function TypeBreakdown({ types }: { types: TypeStat[] }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-3 sm:p-4" aria-labelledby="type-breakdown-heading">
      <h3 id="type-breakdown-heading" className="text-base font-semibold">
        Card types
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Each card is counted once, using the same type order as the deck list.
      </p>
      {types.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No cards on the mainboard.</p>
      ) : (
        <ul className="mt-3 flex min-w-0 flex-wrap gap-2">
          {types.map((type) => (
            <li
              key={type.type}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/80 bg-background/60 px-3 py-1 text-sm"
            >
              <span className="min-w-0 break-words">{type.type}</span>
              <span className="font-medium tabular-nums">{type.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
