import { promises as fs } from "fs";
import path from "path";
import type {
  Comment,
  Deck,
  DeckCard,
  FavoriteCard,
  Friendship,
  PublicProfile,
} from "@/lib/types";

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
  comments: Comment[];
  sessions: Record<string, string>;
}

const STORE_PATH = path.join(process.cwd(), ".data", "store.json");

const emptyStore = (): DataStore => ({
  users: [],
  friendships: [],
  favorites: [],
  decks: [],
  deckCards: [],
  comments: [],
  sessions: {},
});

let writeQueue: Promise<void> = Promise.resolve();

export async function readStore(): Promise<DataStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DataStore>;
    return {
      ...emptyStore(),
      ...parsed,
      users: parsed.users ?? [],
      friendships: parsed.friendships ?? [],
      favorites: parsed.favorites ?? [],
      decks: parsed.decks ?? [],
      deckCards: parsed.deckCards ?? [],
      comments: parsed.comments ?? [],
      sessions: parsed.sessions ?? {},
    };
  } catch {
    const store = emptyStore();
    await writeStore(store);
    return store;
  }
}

export async function writeStore(store: DataStore): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  });
  await writeQueue;
}

export async function updateStore<T>(
  updater: (store: DataStore) => T | Promise<T>,
): Promise<T> {
  const store = await readStore();
  const result = await updater(store);
  await writeStore(store);
  return result;
}
