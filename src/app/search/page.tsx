import { getSessionUser } from "@/lib/auth/session";
import { SearchResults } from "@/components/search/search-results";
import { parseSearchPageQuery } from "@/lib/search-results";

/** Public card, precon, and set search. Adding a card still requires sign-in. */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    type?: string | string[];
    order?: string | string[];
    dir?: string | string[];
    unique?: string | string[];
    view?: string | string[];
  }>;
}) {
  const user = await getSessionUser();
  const query = parseSearchPageQuery(await searchParams);
  return <SearchResults query={query} signedIn={Boolean(user)} />;
}
