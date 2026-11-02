import { NextResponse } from "next/server";
import { isLegendaryCreatureCard } from "@/lib/commander";
import { limit, limitError, requestIp } from "@/lib/rate-limit";
import { searchScryfallCards } from "@/lib/scryfall/client";

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
  const page = Number(searchParams.get("page") ?? "1") || 1;
  // kind=commander: legendary creatures only (Scryfall filter + the same
  // front-face check the server uses when the commander is saved).
  const commander = searchParams.get("kind") === "commander";

  if (q.trim().length < 2) {
    return NextResponse.json({ cards: [], total: 0 });
  }

  try {
    const result = commander
      ? await searchScryfallCards(q, page, "commander", isLegendaryCreatureCard)
      : await searchScryfallCards(q, page);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Could not reach Scryfall" },
      { status: 502 },
    );
  }
}
