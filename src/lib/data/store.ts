import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { isProductionRuntime } from "@/lib/supabase/config";
import type {
  Comment,
  Deck,
  DeckCard,
  DeckCategory,
  DeckTypeOrder,
  FavoriteCard,
  Friendship,
  PublicProfile,
} from "@/lib/types";

/**
 * Local JSON store (.data/store.json): dev/demo only.
 *
 * Safety rules (Cipher PR #3 review, H1):
 * - A missing file (ENOENT) is an empty store. Any other read or parse error
 *   throws and the file is left alone: never "repair" by overwriting.
 * - Writes are atomic: temp file in the same directory, fsync, rename.
 * - Every read-modify-write (updateStore) runs one at a time through an
 *   in-process queue, so concurrent requests can't lose each other's writes.
 *   This only holds within ONE Node process; several instances or serverless
 *   functions must not share the file.
 * - Production refuses local mode unless SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION=1
 *   (assertLocalStoreAllowed, also checked by getBackend()).
 */

export interface LocalUser extends PublicProfile {
  bio: string;
  createdAt: string;
  email: string;
  passwordHash: string;
}

export interface DataStore {
  users: LocalUser[];
  friendships: Friendship[];
  favorites: FavoriteCard[];
  decks: Deck[];
  deckCards: DeckCard[];
  /**
   * Owner-defined categories. Omitted on stores saved before categories
   * existed; readers treat that as none, so old decks keep type groups.
   */
  deckCategories?: DeckCategory[];
  /** Saved type-group positions. Omitted until the owner reorders. */
  deckTypeOrders?: DeckTypeOrder[];
  comments: Comment[];
  sessions: Record<string, string>;
  /**
   * Local-mode fork/copy rate limit (migration 010). One timestamp per
   * successful call. Omitted on stores saved before this field existed.
   */
  forkCopyHits?: { userId: string; at: string }[];
}

type Env = Record<string, string | undefined>;

export const LOCAL_PRODUCTION_FLAG = "SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION";

/** Throws in production unless local mode was explicitly allowed. */
export function assertLocalStoreAllowed(env: Env = process.env): void {
  if (isProductionRuntime(env) && env[LOCAL_PRODUCTION_FLAG]?.trim() !== "1") {
    throw new Error(
      "The local JSON store is for development and demos only and is disabled in production. " +
        `Use SPELLBRANCH_BACKEND=supabase, or set ${LOCAL_PRODUCTION_FLAG}=1 for a single-process demo.`,
    );
  }
}

/** Resolved on each call so tests can point it at a temp directory. */
export function storePath(): string {
  return path.join(process.cwd(), ".data", "store.json");
}

const emptyStore = (): DataStore => ({
  users: [],
  friendships: [],
  favorites: [],
  decks: [],
  deckCards: [],
  comments: [],
  sessions: {},
});

function isErrno(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/** Reads the store. ENOENT -> empty store (nothing written); anything else throws. */
export async function readStore(): Promise<DataStore> {
  assertLocalStoreAllowed();
  const file = storePath();
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return emptyStore();
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Local store ${file} is not valid JSON; refusing to overwrite it.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Local store ${file} is not a JSON object; refusing to overwrite it.`);
  }
  const p = parsed as Partial<DataStore>;
  return {
    ...emptyStore(),
    ...p,
    users: p.users ?? [],
    friendships: p.friendships ?? [],
    favorites: p.favorites ?? [],
    decks: p.decks ?? [],
    deckCards: p.deckCards ?? [],
    deckCategories: p.deckCategories ?? [],
    deckTypeOrders: p.deckTypeOrders ?? [],
    comments: p.comments ?? [],
    sessions: p.sessions ?? {},
  };
}

/** Temp file + fsync + rename, so readers only ever see a complete file. */
async function writeAtomic(store: DataStore): Promise<void> {
  assertLocalStoreAllowed();
  const file = storePath();
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `${path.basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const handle = await fs.open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(store, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  // Best effort: persist the rename itself.
  try {
    const d = await fs.open(dir, "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } catch {
    /* some platforms can't fsync a directory */
  }
}

// One queue per process. Kept on globalThis so every bundle/chunk that
// imports this module shares it.
const LOCK_KEY = Symbol.for("spellbranch.localStore.lock");
type LockHolder = { [LOCK_KEY]?: Promise<unknown> };

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const holder = globalThis as LockHolder;
  const previous = holder[LOCK_KEY] ?? Promise.resolve();
  const run = previous.then(task);
  holder[LOCK_KEY] = run.catch(() => undefined);
  return run;
}

/** Replaces the whole store (serialized with updateStore). */
export function writeStore(store: DataStore): Promise<void> {
  return enqueue(() => writeAtomic(store));
}

/**
 * Read -> modify -> write as one serialized step. If the updater throws,
 * nothing is written.
 */
export function updateStore<T>(
  updater: (store: DataStore) => T | Promise<T>,
): Promise<T> {
  return enqueue(async () => {
    const store = await readStore();
    const result = await updater(store);
    await writeAtomic(store);
    return result;
  });
}
