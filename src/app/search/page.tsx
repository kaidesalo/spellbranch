import { requireUser } from "@/lib/auth/require-user";
import { SearchResults } from "@/components/search/search-results";
import { parseSearchPageQuery } from "@/lib/search-results";

/**
 * Signed-in, same as Browse, Collection, and the header search dialog.
 * The search API itself stays public and rate-limited.
 */
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
  await requireUser();
  const query = parseSearchPageQuery(await searchParams);
  return <SearchResults query={query} />;
}
