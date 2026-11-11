"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
  reorderDeckSectionsAction,
} from "@/lib/actions/decks";
import { categoryNameLength, groupDeckCards, sectionKey } from "@/lib/deck-categories";
import { LIMITS } from "@/lib/data/limits";
import type { DeckCard, DeckCategory, DeckTypeOrder } from "@/lib/types";

function moveItem(keys: string[], from: number, to: number): string[] {
  if (to < 0 || to >= keys.length || from === to) return keys;
  const next = keys.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Create, rename, delete, and reorder the groups on a deck. Type groups can
 * be reordered but not renamed or deleted: they are where unassigned cards
 * land. Deleting a category asks first and does not remove its cards.
 */
export function CategoryManager({
  deckId,
  cards,
  categories,
  typeSectionOrders,
}: {
  deckId: string;
  cards: DeckCard[];
  categories: DeckCategory[];
  typeSectionOrders: DeckTypeOrder[];
}) {
  const sections = groupDeckCards(cards, categories, typeSectionOrders);
  const serverKeys = sections.map(sectionKey).join("\n");
  const [keys, setKeys] = useState(() => sections.map(sectionKey));
  const [seen, setSeen] = useState(serverKeys);
  if (seen !== serverKeys) {
    setSeen(serverKeys);
    setKeys(sections.map(sectionKey));
  }

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byKey = new Map(sections.map((section) => [section.key, section]));
  const rows = keys.flatMap((key) => {
    const section = byKey.get(key);
    return section ? [section] : [];
  });

  function persist(next: string[]) {
    const previous = keys;
    setKeys(next);
    startTransition(async () => {
      const result = await reorderDeckSectionsAction(deckId, next);
      if (result.error) {
        setKeys(previous);
        toast.error(result.error);
      }
    });
  }

  function addCategory(event: FormEvent) {
    event.preventDefault();
    const trimmed = name;
    startTransition(async () => {
      const result = await createCategoryAction(deckId, trimmed);
      if (result.error) toast.error(result.error);
      else {
        setName("");
        toast.success("Category added");
      }
    });
  }

  function saveRename(categoryId: string) {
    startTransition(async () => {
      const result = await renameCategoryAction(deckId, categoryId, draft);
      if (result.error) toast.error(result.error);
      else {
        setEditing(null);
        toast.success("Category renamed");
      }
    });
  }

  function remove(categoryId: string) {
    startTransition(async () => {
      const result = await deleteCategoryAction(deckId, categoryId);
      if (result.error) toast.error(result.error);
      else {
        setConfirming(null);
        toast.success("Category deleted. Its cards are back in their type groups.");
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="max-w-full shrink max-sm:px-2 max-sm:tracking-normal!"
        data-testid="manage-categories"
        onClick={() => setOpen(true)}
      >
        Categories
      </Button>
      {open && (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          data-testid="category-manager"
          className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <SheetHeader className="pr-10 text-left">
            <SheetTitle className="font-display text-xl">Categories</SheetTitle>
            <SheetDescription>
              New cards stay in their type group until you move them. Deleting a category puts its cards back there.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={addCategory} className="flex items-center gap-2 px-4">
            <label className="sr-only" htmlFor="new-category-name">
              New category name
            </label>
            <Input
              id="new-category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ramp, card draw…"
              disabled={pending}
              autoComplete="off"
            />
            <Button type="submit" size="sm" disabled={pending || categoryNameLength(name.trim()) < 1}>
              Add
            </Button>
          </form>
          <p className="px-4 text-xs text-muted-foreground tabular-nums">
            {categoryNameLength(name.trim())}/{LIMITS.categoryName}
          </p>

          <ul className="flex flex-col gap-2 px-4 pb-6">
            {rows.map((section, index) => {
              const isCategory = section.kind === "category";
              return (
                <li
                  key={section.key}
                  className="rounded-xl border border-border/80 bg-background/60 p-3"
                  onDragOver={(event) => {
                    if (dragKey) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!dragKey || pending) return;
                    const from = keys.indexOf(dragKey);
                    persist(moveItem(keys, from, index));
                    setDragKey(null);
                  }}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      draggable={!pending}
                      aria-label={`Drag ${section.label}`}
                      className="mt-0.5 hidden cursor-grab text-muted-foreground active:cursor-grabbing lg:inline-flex"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", section.key);
                        setDragKey(section.key);
                      }}
                      onDragEnd={() => setDragKey(null)}
                    >
                      <GripVertical className="size-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                      {editing === section.categoryId && isCategory ? (
                        <form
                          className="flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (section.categoryId) saveRename(section.categoryId);
                          }}
                        >
                          <label className="sr-only" htmlFor={`rename-${section.key}`}>
                            Rename {section.label}
                          </label>
                          <Input
                            id={`rename-${section.key}`}
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            disabled={pending}
                            autoFocus
                          />
                          <Button type="submit" size="sm" disabled={pending}>
                            Save
                          </Button>
                        </form>
                      ) : (
                        <>
                          <p className="break-words font-medium">{section.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {isCategory ? "Category" : "Type group"} · {section.count}
                          </p>
                        </>
                      )}
                      {confirming === section.categoryId && isCategory && (
                        <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2">
                          <p className="text-sm">
                            Delete {section.label}? Its cards stay in the deck and go back to their type groups.
                          </p>
                          <div className="mt-2 flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={pending}
                              onClick={() => section.categoryId && remove(section.categoryId)}
                            >
                              Delete
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => setConfirming(null)}
                            >
                              Keep
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="outline"
                        className="max-sm:size-8!"
                        disabled={pending || index === 0}
                        aria-label={`Move ${section.label} earlier`}
                        onClick={() => persist(moveItem(keys, index, index - 1))}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="outline"
                        className="max-sm:size-8!"
                        disabled={pending || index === rows.length - 1}
                        aria-label={`Move ${section.label} later`}
                        onClick={() => persist(moveItem(keys, index, index + 1))}
                      >
                        <ChevronDown />
                      </Button>
                      {isCategory && editing !== section.categoryId && confirming !== section.categoryId && (
                        <>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            className="max-sm:size-8!"
                            disabled={pending}
                            aria-label={`Rename ${section.label}`}
                            onClick={() => {
                              setEditing(section.categoryId);
                              setDraft(section.label);
                              setConfirming(null);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            className="max-sm:size-8!"
                            disabled={pending}
                            aria-label={`Delete ${section.label}`}
                            onClick={() => {
                              setConfirming(section.categoryId);
                              setEditing(null);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {rows.length === 0 && (
              <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                Add a category, or add cards and their type groups will show up here.
              </li>
            )}
          </ul>
        </SheetContent>
      </Sheet>
      )}
    </>
  );
}
