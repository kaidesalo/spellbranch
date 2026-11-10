import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompareData, getDeckById } from "@/lib/queries/decks";
import { CompareView } from "@/components/decks/compare-view";
import { toCompareSide } from "@/lib/compare-dto";
import { Button } from "@/components/ui/button";

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { id } = await params;
  const { branch: branchId } = await searchParams;
  const source = await getDeckById(id);
  if (!source) notFound();

  const branches = source.forkedFromId
    ? []
    : (source.branches ?? []);

  // If this page is opened on a branch, treat its parent as source.
  const sourceId = source.forkedFromId ?? source.id;
  // A preferred branch the viewer can't see isn't in `branches`: fall back to
  // the first visible one rather than 404 (review L1).
  const visiblePreferred = branches.find((b) => b.id === source.preferredBranchId)?.id;
  const effectiveBranchId =
    branchId ||
    (source.forkedFromId ? source.id : visiblePreferred ?? branches[0]?.id);

  if (!effectiveBranchId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
        <h1 className="text-2xl font-semibold">No branch to compare</h1>
        <p className="mt-2 text-muted-foreground">
          Fork this deck first, then come back to compare versions.
        </p>
        <Button className="mt-4" render={<Link href={`/decks/${id}`} />}>
          Back to deck
        </Button>
      </div>
    );
  }

  const data = await getCompareData(sourceId, effectiveBranchId);
  if (!data) notFound();

  const selectable =
    data.source.branches ??
    [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Compare</h1>
          <p className="mt-1 text-muted-foreground">
            Side-by-side changes between the source list and a branch.
          </p>
        </div>
        <Button variant="outline" render={<Link href={`/decks/${sourceId}`} />}>
          Back to source
        </Button>
      </div>

      {selectable.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {selectable.map((b) => (
            <Button
              key={b.id}
              size="sm"
              variant={b.id === effectiveBranchId ? "default" : "outline"}
              render={
                <Link href={`/decks/${sourceId}/compare?branch=${b.id}`} />
              }
            >
              {b.name}
              {b.owner?.username ? ` @${b.owner.username}` : ""}
            </Button>
          ))}
        </div>
      )}

      {/* Client component: pass only what it renders (review M1). */}
      <CompareView
        source={toCompareSide(data.source)}
        branch={toCompareSide(data.branch)}
        isPreferred={data.source.preferredBranchId === data.branch.id}
        canSetPreferred={data.canSetPreferred}
      />
    </div>
  );
}
