"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { RefreshCw, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ZoomCard } from "@/lib/card-zoom";
import { cn } from "@/lib/utils";

/**
 * Click-to-zoom for a card. Wraps `children` (a card name, a thumbnail, or
 * both) in a real <button> that opens a lightbox with the large card image.
 *
 * The lightbox is the repo's Base UI Dialog, which gives us role="dialog",
 * a focus trap, Esc and backdrop-click to close, focus returning to this
 * button, and no page scroll while it's open.
 *
 * Only the wrapped children open it, so -/+, quantity, trash and other
 * controls next to it in a row keep working as before. With no image
 * (`card` is null) the children render as they are, without a button.
 */
export function CardZoom({
  card,
  children,
  className,
}: {
  card: ZoomCard | null;
  children: ReactNode;
  className?: string;
}) {
  if (!card) return <>{children}</>;

  return (
    <Dialog>
      <DialogTrigger
        aria-label={`${card.name}, view larger image`}
        className={cn(
          "group/zoom cursor-zoom-in rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        {children}
      </DialogTrigger>
      <DialogPortal>
        <DialogOverlay className="bg-black/75" />
        <DialogPrimitive.Popup
          data-slot="card-zoom"
          aria-modal="true"
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),26rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-2xl border-2 border-primary bg-card p-3 text-card-foreground shadow-[6px_6px_0_0_#344158] outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <CardZoomBody card={card} />
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

/** The lightbox contents. Mounted on open, so the face and errors reset each time. */
function CardZoomBody({ card }: { card: ZoomCard }) {
  const [faceIndex, setFaceIndex] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const face = card.faces[faceIndex] ?? card.faces[0];
  const hasBack = card.faces.length > 1;
  const nextFace = card.faces[(faceIndex + 1) % card.faces.length];

  // Large image first, then the smaller one we already had, then a message.
  const candidates = [face.src, face.fallbackSrc].filter((s): s is string => s !== null);
  const src = candidates.find((s) => !failed.includes(s));

  return (
    <>
      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0">
          <p className="label-caps text-muted-foreground">
            {hasBack ? `Face ${faceIndex + 1} of ${card.faces.length}` : "Card"}
          </p>
          <DialogTitle className="mt-1 font-sans text-lg leading-tight font-bold">
            {card.name}
          </DialogTitle>
        </div>
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}
        >
          <XIcon />
        </DialogClose>
      </div>

      <div className="flex min-h-0 justify-center">
        {src ? (
          <Image
            key={src}
            src={src}
            alt={hasBack ? `${face.name} (${card.name})` : card.name}
            width={672}
            height={936}
            className="h-auto max-h-[calc(100dvh-10rem)] w-auto max-w-full rounded-[4.75%/3.5%] object-contain"
            onError={() => setFailed((list) => [...list, src])}
            unoptimized
          />
        ) : (
          <div
            role="img"
            aria-label={`${face.name}: image unavailable`}
            className="flex aspect-[5/7] w-full items-center justify-center rounded-xl bg-muted px-6 text-center text-sm text-muted-foreground"
          >
            Couldn&apos;t load the card image.
          </div>
        )}
      </div>

      {hasBack && (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          onClick={() => setFaceIndex((i) => (i + 1) % card.faces.length)}
        >
          <RefreshCw data-icon="inline-start" />
          Show {nextFace.name}
        </Button>
      )}
    </>
  );
}
