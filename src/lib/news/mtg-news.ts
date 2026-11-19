/**
 * Latest articles from Daily MTG (https://magic.wizards.com/en/news).
 *
 * Checked and not usable (2026-11-19): /en/rss, /rss, /en/rss.xml, /en/feed,
 * /en/atom, /en/news/feed, /en/news.rss, /en/news/rss all 404. The news page
 * head has hreflang alternates only, no RSS/Atom link. There is no public
 * JSON feed. The page is server-rendered HTML (article cards) and each
 * article page has a <time> and an og:image on images.ctfassets.net.
 */

export const MTG_NEWS_PAGE = "https://magic.wizards.com/en/news";
export const MTG_NEWS_HOST = "magic.wizards.com";
export const MTG_NEWS_IMAGE_HOST = "images.ctfassets.net";
export const MTG_NEWS_LIMIT = 6;

const USER_AGENT = "Spellbranch/1.0 (Magic news links; +https://github.com/kaidesalo/spellbranch)";
const TIMEOUT_MS = 5000;
const MAX_BYTES = 1_500_000;

export type MtgNewsItem = {
  title: string;
  url: string;
  /** YYYY-MM-DD when the article page states one. */
  date: string | null;
  excerpt: string | null;
  category: string | null;
  image: string | null;
};

const ARTICLE_PATH = /^\/en\/news\/[a-z0-9-]+\/[a-z0-9-]+$/i;

export function stripHtml(input: string): string {
  const withoutBlocks = input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, " ");
  const text = withoutBlocks.replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => fromCodePoint(parseInt(num, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&reg;/gi, "®")
    .replace(/&trade;/gi, "™");
}

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** First two sentences, otherwise a short clip. Never returns markup. */
export function truncateExcerpt(input: string, max = 220): string | null {
  const text = stripHtml(input);
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const clipped = sentences.length > 2 ? `${sentences[0]} ${sentences[1]}` : text;
  if (clipped.length <= max) return clipped;
  const cut = clipped.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** https URL on an exact host, or null. */
export function httpsUrlOnHost(value: string, host: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.hostname !== host) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function articleUrl(value: string): string | null {
  const raw = value.trim();
  const absolute = raw.startsWith("/") ? `https://${MTG_NEWS_HOST}${raw}` : raw;
  const url = httpsUrlOnHost(absolute, MTG_NEWS_HOST);
  if (!url) return null;
  const parsed = new URL(url);
  if (!ARTICLE_PATH.test(parsed.pathname)) return null;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function imageUrl(value: string): string | null {
  const url = httpsUrlOnHost(value.trim(), MTG_NEWS_IMAGE_HOST);
  if (!url) return null;
  if (/logo|favicon|wizards_icon/i.test(new URL(url).pathname)) return null;
  return url;
}

function categoryFromUrl(url: string): string | null {
  const section = new URL(url).pathname.split("/")[3] ?? "";
  if (!section) return null;
  const known: Record<string, string> = {
    announcements: "Announcements",
    feature: "Feature",
    "magic-story": "Magic Story",
    "making-magic": "Making Magic",
    "card-preview": "Card Preview",
    "mtg-arena": "MTG Arena",
  };
  return known[section] ?? section.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function field(chunk: string, pattern: RegExp): string | null {
  const match = pattern.exec(chunk);
  const text = match?.[1] ? stripHtml(match[1]) : "";
  return text || null;
}

/** Article cards from the Daily MTG news HTML. Order is the page order. */
export function parseNewsListing(html: string): MtgNewsItem[] {
  const parts = html.split("data-article-hub-card").slice(1);
  const seen = new Set<string>();
  const items: MtgNewsItem[] = [];
  for (const chunk of parts) {
    const href = /href="([^"]+)"/i.exec(chunk)?.[1] ?? "";
    const url = articleUrl(href);
    if (!url || seen.has(url)) continue;
    const title = field(chunk, /<h3[^>]*>\s*([\s\S]*?)<\/h3>/i);
    if (!title) continue;
    seen.add(url);
    const category = field(chunk, /css-KLPvC[^>]*>\s*([\s\S]*?)<\/div>/i) ?? categoryFromUrl(url);
    const excerpt = truncateExcerpt(/<p[^>]*>([\s\S]*?)<\/p>/i.exec(chunk)?.[1] ?? "");
    const image = imageFromHtml(chunk);
    items.push({ title, url, date: dateFromHtml(chunk), excerpt, category, image });
  }
  return items;
}

/** Date and thumbnail from one article page. */
export function parseArticleMeta(html: string): { date: string | null; image: string | null; excerpt: string | null } {
  return {
    date: dateFromHtml(html),
    image: ogImage(html) ?? imageFromHtml(html),
    excerpt: truncateExcerpt(
      /<meta[^>]+name="description"[^>]+content="([^"]*)"/i.exec(html)?.[1] ??
        /<meta[^>]+content="([^"]*)"[^>]+name="description"/i.exec(html)?.[1] ??
        "",
    ),
  };
}

function ogImage(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/property="og:image"/i.test(tag) && !/property='og:image'/i.test(tag)) continue;
    const content = /content="([^"]+)"/i.exec(tag)?.[1] ?? /content='([^']+)'/i.exec(tag)?.[1];
    if (!content) continue;
    const image = imageUrl(decodeEntities(content));
    if (image) return image;
  }
  return null;
}

function imageFromHtml(html: string): string | null {
  const sources = html.match(/https?:\/\/images\.ctfassets\.net[^"'\\\s>]*/gi) ?? [];
  for (const source of sources) {
    const image = imageUrl(decodeEntities(source.replace(/&amp;/g, "&")));
    if (image) return image;
  }
  return null;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

export function parseNewsDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return validIso(date) ? date : null;
  }
  const words = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(value.trim());
  if (!words) return null;
  const month = MONTHS[words[1]!.toLowerCase()];
  if (!month) return null;
  const day = words[2]!.padStart(2, "0");
  const date = `${words[3]}-${month}-${day}`;
  return validIso(date) ? date : null;
}

function validIso(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function dateFromHtml(html: string): string | null {
  const stamped = /<time[^>]*datetime="(\d{4}-\d{2}-\d{2})/i.exec(html);
  if (stamped) return parseNewsDate(stamped[1]!);
  const text = /<time[^>]*>\s*([^<]+?)\s*<\/time>/i.exec(html);
  if (text) return parseNewsDate(stripHtml(text[1]!));
  return null;
}

/** Newest first. Undated items keep their incoming order after dated ones. At most `limit`. */
export function selectLatest(items: MtgNewsItem[], limit = MTG_NEWS_LIMIT): MtgNewsItem[] {
  const ranked = items.map((item, index) => ({ item, index }));
  ranked.sort((a, b) => {
    if (a.item.date && b.item.date && a.item.date !== b.item.date) {
      return a.item.date < b.item.date ? 1 : -1;
    }
    if (a.item.date && !b.item.date) return -1;
    if (!a.item.date && b.item.date) return 1;
    return a.index - b.index;
  });
  return ranked.slice(0, limit).map((row) => row.item);
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    signal,
    redirect: "follow",
    credentials: "omit",
    headers: {
      accept: "text/html",
      "user-agent": USER_AGENT,
    },
    next: { revalidate: 3600 },
  });
  let finalHost = "";
  try {
    finalHost = new URL(res.url).hostname;
  } catch {
    finalHost = "";
  }
  if (!res.ok || finalHost !== MTG_NEWS_HOST) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error("news fetch failed");
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("news page too large");
  return text;
}

/**
 * Server-only read of Daily MTG. Any failure is an empty list so the home
 * page still renders. Set SPELLBRANCH_MTG_NEWS=off to force that empty list.
 */
export async function getMtgNews(): Promise<MtgNewsItem[]> {
  if (process.env.SPELLBRANCH_MTG_NEWS === "off") return [];
  try {
    const html = await fetchText(MTG_NEWS_PAGE, AbortSignal.timeout(TIMEOUT_MS));
    const listed = parseNewsListing(html).slice(0, 8);
    const enriched = await Promise.all(
      listed.map(async (item) => {
        try {
          const article = await fetchText(item.url, AbortSignal.timeout(TIMEOUT_MS));
          const meta = parseArticleMeta(article);
          return {
            ...item,
            date: meta.date ?? item.date,
            image: meta.image ?? item.image,
            excerpt: item.excerpt ?? meta.excerpt,
          };
        } catch {
          return item;
        }
      }),
    );
    return selectLatest(enriched);
  } catch {
    return [];
  }
}
