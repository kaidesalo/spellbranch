import { MTG_NEWS_PAGE, type MtgNewsItem } from "@/lib/news/mtg-news";

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Latest Daily MTG articles. Plain text only: titles and excerpts are already
 * stripped of HTML. Links leave the site.
 */
export function MtgNewsSection({ articles }: { articles: MtgNewsItem[] }) {
  return (
    <section aria-labelledby="mtg-news-heading" className="border-t border-border/60 bg-card/40 py-16" data-testid="mtg-news">
      <div className="mx-auto min-w-0 max-w-7xl px-4 sm:px-6">
        <h2 id="mtg-news-heading" className="label-caps text-sm text-foreground">
          Latest Magic news
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Headlines from{" "}
          <a
            href={MTG_NEWS_PAGE}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-border underline-offset-2 hover:text-foreground"
          >
            Daily MTG
          </a>
          . Each one opens on magic.wizards.com.
        </p>
        {articles.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground" data-testid="mtg-news-unavailable">
            News unavailable right now.
          </p>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <li key={article.url} className="min-w-0">
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {article.image ? (
                    // Article art is on images.ctfassets.net. Plain img matches other off-site pictures.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={article.image}
                      alt=""
                      width={640}
                      height={360}
                      className="aspect-video w-full bg-background object-cover"
                    />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center bg-background text-xs text-muted-foreground">
                      No image
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
                    <p className="text-xs text-muted-foreground">
                      {[article.category, article.date ? formatDate(article.date) : null].filter(Boolean).join(" · ")}
                    </p>
                    <p className="break-words text-base font-medium text-foreground">{article.title}</p>
                    {article.excerpt ? (
                      <p className="break-words text-sm text-muted-foreground">{article.excerpt}</p>
                    ) : null}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
