import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-semibold">Not found</h1>
      <p className="mt-2 text-muted-foreground">
        That page or deck is unavailable, or you do not have permission to view
        it.
      </p>
      <Button className="mt-6" render={<Link href="/dashboard" />}>
        Go home
      </Button>
    </div>
  );
}
