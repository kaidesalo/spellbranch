import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SignJWT } from "jose";

const USER = "a4000000-0000-4000-8000-0000000000aa";
const DECK = "d4000000-0000-4000-8000-0000000000aa";
const SECRET = "spellbranch-local-dev-secret-change-me";

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return `${salt}:${hash}`;
}

function card(
  id: string,
  name: string,
  typeLine: string,
  manaCost: string | null,
  board: "main" | "side" | "maybe" = "main",
  quantity = 1,
) {
  return {
    id,
    deckId: DECK,
    scryfallId: id,
    cardName: name,
    imageUri: null,
    manaCost,
    typeLine,
    colors: ["B"],
    colorIdentity: ["B"],
    oracleText: null,
    quantity,
    categoryId: null,
    board,
    createdAt: "2026-11-11T00:00:00.000Z",
  };
}

test.beforeAll(async () => {
  const now = "2026-11-11T00:00:00.000Z";
  const store = {
    users: [
      {
        id: USER,
        username: "stats",
        displayName: "Stats",
        email: "stats@example.test",
        bio: "",
        avatarUrl: null,
        passwordHash: hashPassword("spellbranch-dev-only"),
        createdAt: now,
      },
    ],
    friendships: [],
    favorites: [],
    decks: [
      {
        id: DECK,
        ownerId: USER,
        name: "Stomp Stats",
        format: "commander",
        notes: "",
        visibility: "private",
        allowForks: false,
        forkedFromId: null,
        copiedFromId: null,
        preferredBranchId: null,
        commander: {
          scryfallId: "gisa-stats",
          cardName: "Ghoulcaller Gisa",
          typeLine: "Legendary Creature — Human Wizard",
          manaCost: "{3}{B}{B}{B}",
          imageUri: null,
          artUri: null,
          colorIdentity: ["B"],
        },
        colors: ["B"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    deckCards: [
      card("creature-1", "Champion of the Perished", "Creature — Zombie", "{B}"),
      card("instant-1", "Dark Ritual", "Instant", "{1}{B}"),
      card("land-1", "Swamp", "Basic Land — Swamp", null, "main", 2),
      card("side-big", "Emrakul", "Creature — Eldrazi", "{15}", "side"),
    ],
    deckCategories: [],
    deckTypeOrders: [],
    comments: [],
    collectionCards: [],
    sessions: {},
  };
  const dir = path.join(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "store.json"), JSON.stringify(store, null, 2));
});

test.beforeEach(async ({ context }) => {
  const token = await new SignJWT({
    id: USER,
    email: "stats@example.test",
    username: "stats",
    displayName: "Stats",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1d")
    .sign(new TextEncoder().encode(SECRET));
  await context.addCookies([
    {
      name: "spellbranch_session",
      value: token,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});

async function noOverflow(page: import("@playwright/test").Page, label: string) {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const past: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.right > vw + 1) {
        const name = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName;
        past.push(`${el.tagName} ${name} right=${Math.round(box.right)}`);
        if (past.length >= 6) break;
      }
    }
    return { scroll: doc.scrollWidth, client: doc.clientWidth, past };
  });
  expect(report.scroll, `${label} via ${report.past.join(" | ")}`).toBe(report.client);
}

test("deck stats fit on a phone and ignore the sideboard", async ({ page }) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/decks/${DECK}`);
    const stats = page.getByTestId("deck-stats");
    await expect(stats.getByTestId("deck-stats-bar")).toContainText("Commander");
    await expect(stats.getByTestId("deck-stats-bar")).toContainText("1 commander + 4 cards");
    await expect(stats.getByTestId("deck-stats-bar")).toContainText("3.00");
    await expect(stats.getByTestId("deck-stats-bar")).toContainText("est.");
    await expect(stats.getByTestId("curve-7+")).toHaveAttribute("data-count", "0");
    await expect(stats.getByTestId("curve-6")).toHaveAttribute("data-count", "1");
    await expect(stats.getByText("3 spells")).toBeVisible();
    await expect(stats.getByTestId("color-stat-B")).toBeVisible();
    await expect(stats.getByTestId("color-stat-R")).toHaveCount(0);
    const bar = await stats.getByTestId("deck-stats-bar").boundingBox();
    expect(bar).not.toBeNull();
    expect(bar!.width).toBeLessThanOrEqual(width);
    if (width <= 390) expect(bar!.height).toBeGreaterThan(40);
    await noOverflow(page, `stats ${width}`);
  }
});

test("desktop deck stats do not widen the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/decks/${DECK}`);
  await expect(page.getByTestId("deck-stats-bar")).toContainText("Avg CMC");
  await expect(page.getByRole("heading", { name: "Mana curve" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Color requirements" })).toBeVisible();
  await noOverflow(page, "desktop stats");
});

test("webkit screenshots of the deck stats", async ({ page }) => {
  const dir = existsSync("/opt/cursor/artifacts") ? "/opt/cursor/artifacts" : "test-results/deck-stats";
  mkdirSync(dir, { recursive: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/decks/${DECK}`);
  const stats = page.getByTestId("deck-stats");
  await expect(stats.getByText("3 spells")).toBeVisible();
  await page.addStyleTag({
    content: "header { display: none !important; } nextjs-portal { display: none !important; }",
  });
  await stats.screenshot({ path: `${dir}/webkit-390-deck-stats.png` });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/decks/${DECK}`);
  const wide = page.getByTestId("deck-stats");
  await expect(wide.getByText("3 spells")).toBeVisible();
  await page.addStyleTag({
    content: "header { display: none !important; } nextjs-portal { display: none !important; }",
  });
  await wide.screenshot({ path: `${dir}/desktop-1280-deck-stats.png` });
});
