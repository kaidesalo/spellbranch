import { NextResponse } from "next/server";
import { isLegendaryCreatureCard } from "@/lib/commander";
import { SORT_DIRECTIONS, SORT_ORDERS, validateSearchInput } from "@/lib/advanced-search";
import { limit, limitError, requestIp } from "@/lib/rate-limit";
import { searchScryfallAutocomplete, searchScryfallCards, searchScryfallCatalog } from "@/lib/scryfall/client";

const ORDERS = new Set<string>(SORT_ORDERS);
const DIRS = new Set<string>(SORT_DIRECTIONS);

function publicSearchError(error: string): string {
  return error === "Could not reach Scryfall" ? error : "Scryfall search failed";
}

export async function GET(request: Request) {
  // Cipher PR #9 L2: public, so limited per IP before Scryfall is called.
  const allowed = await limit("scryfall-search", { ip: await requestIp() });
  if (!allowed.ok) {
    const body = limitError(allowed);
    return NextResponse.json(body, {
      status: allowed.reason === "limited" ? 429 : 503,
      headers: body.retryAfterSec ? { "Retry-After": String(body.retryAfterSec) } : undefined,
    });
  }
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const checked = validateSearchInput(q, searchParams.get("page"));
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const page = checked.page;
  const orderRaw = searchParams.get("order");
  const dirRaw = searchParams.get("dir");
  const uniqueRaw = searchParams.get("unique");
  if ((orderRaw != null && !ORDERS.has(orderRaw)) || (dirRaw != null && !DIRS.has(dirRaw))) {
    return NextResponse.json({ error: "Search query is invalid" }, { status: 400 });
  }
  if (uniqueRaw != null && uniqueRaw !== "cards" && uniqueRaw !== "prints") {
    return NextResponse.json({ error: "Search query is invalid" }, { status: 400 });
  }
  // kind=commander: legendary creatures only (Scryfall filter + the same
  // front-face check the server uses when the commander is saved).
  const commander = searchParams.get("kind") === "commander";
  const scope = searchParams.get("scope");
  const catalog = scope === "sets" || scope === "precons" ? scope : null;

  if (scope === "autocomplete") {
    if (q.trim().length < 2) return NextResponse.json({ names: [] });
    try {
      const result = await searchScryfallAutocomplete(q);
      if (result.error) {
        return NextResponse.json({ error: publicSearchError(result.error) }, { status: 502 });
      }
      return NextResponse.json({ names: result.names });
    } catch {
      return NextResponse.json({ error: "Could not reach Scryfall" }, { status: 502 });
    }
  }

  if (q.trim().length < 2) {
    return NextResponse.json(catalog ? { sets: [] } : { cards: [], total: 0 });
  }

  if (catalog) {
    try {
      const result = await searchScryfallCatalog(q, catalog);
      if (result.error) {
        return NextResponse.json({ error: publicSearchError(result.error) }, { status: 502 });
      }
      return NextResponse.json({ sets: result.sets });
    } catch {
      return NextResponse.json({ error: "Could not reach Scryfall" }, { status: 502 });
    }
  }

  try {
    const extra = {
      unique: uniqueRaw === "prints" ? ("prints" as const) : ("cards" as const),
      order: orderRaw ?? undefined,
      dir: dirRaw ?? undefined,
    };
    const result = commander
      ? await searchScryfallCards(q, page, "commander", isLegendaryCreatureCard, extra)
      : await searchScryfallCards(q, page, "card", undefined, extra);
    if (result.error) {
      return NextResponse.json({ error: publicSearchError(result.error) }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Could not reach Scryfall" },
      { status: 502 },
    );
  }
}
