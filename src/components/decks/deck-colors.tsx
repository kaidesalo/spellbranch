import { ManaSymbol } from "@/components/cards/mana-symbols";
import { resolveSymbol } from "@/lib/mana";
import { COLOR_COMBOS, COLOR_NAMES, comboFor, type ColorCombo } from "@/lib/deck-colors";
import { cn } from "@/lib/utils";

/** The pips for a set of colors ({C} for Colorless), hidden from screen readers. */
export function ColorPips({ colors, className }: { colors: readonly string[]; className?: string }) {
  const symbols = (colors.length ? colors : ["C"]).map((c) => resolveSymbol(`{${c}}`)!);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden>
      {symbols.map((s) => (
        <ManaSymbol key={s.slug} symbol={s} decorative />
      ))}
    </span>
  );
}

/** "Blue, Black" (what the pips say), for screen readers and titles. */
export function colorList(combo: ColorCombo): string {
  return combo.colors.length ? combo.colors.map((c) => COLOR_NAMES[c]).join(", ") : "no colors";
}

/** A deck's colors as a small read-only chip: name and pips. */
export function DeckColorsBadge({ colors }: { colors: readonly string[] }) {
  const combo = comboFor(colors);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-border bg-card px-2.5 py-0.5 text-xs font-semibold text-foreground"
      data-testid="deck-colors"
    >
      <ColorPips colors={combo.colors} className="text-sm" />
      {combo.name}
      {combo.colors.length > 1 && <span className="sr-only"> ({colorList(combo)})</span>}
    </span>
  );
}

const GROUPS = ["Mono", "Guilds", "Shards and wedges", "Four colors", "Other"] as const;

/**
 * The deck color picker: one radio group (name "colors", value = combo key
 * such as "UB" or "C"), its chips grouped by size. Each chip's label is the
 * combo's name, with its colors spelled out for screen readers; the pips are
 * decorative. `required` makes picking one mandatory (new decks).
 */
export function ColorPicker({
  defaultColors,
  required,
  describedBy,
}: {
  defaultColors: readonly string[] | null;
  required: boolean;
  describedBy?: string;
}) {
  const defaultKey = defaultColors ? comboFor(defaultColors).key : undefined;
  return (
    <fieldset className="space-y-3" aria-describedby={describedBy}>
      <legend id="colors-legend" className="label-caps mb-1 text-sm text-foreground">
        Deck colors{required && <span aria-hidden> *</span>}
      </legend>
      <div role="radiogroup" aria-labelledby="colors-legend" aria-required={required} className="space-y-3">
        {GROUPS.map((group) => (
          <div key={group} className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" aria-hidden>
              {group}
            </p>
            <div className="flex flex-wrap gap-2">
              {COLOR_COMBOS.filter((c) => c.group === group).map((combo) => (
                <ColorChip
                  key={combo.key}
                  combo={combo}
                  defaultChecked={combo.key === defaultKey}
                  required={required}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function ColorChip({
  combo,
  defaultChecked,
  required,
}: {
  combo: ColorCombo;
  defaultChecked: boolean;
  required: boolean;
}) {
  const id = `colors-${combo.key}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full border-2 border-border bg-card px-3 py-1 text-sm font-semibold text-foreground transition",
        "hover:-translate-y-px hover:shadow-[2px_2px_0_0_#344158]",
        "has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:shadow-[3px_3px_0_0_#E8B76A]",
        "has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
      )}
      title={combo.colors.length > 1 ? colorList(combo) : undefined}
    >
      <input
        id={id}
        type="radio"
        name="colors"
        value={combo.key}
        defaultChecked={defaultChecked}
        required={required}
        className="peer sr-only"
      />
      <ColorPips colors={combo.colors} className="text-base" />
      <span>{combo.name}</span>
      {combo.colors.length > 1 && <span className="sr-only"> ({colorList(combo)})</span>}
    </label>
  );
}
