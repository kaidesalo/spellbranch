import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SignJWT } from "jose";

const USER = "a2000000-0000-4000-8000-0000000000aa";
const DECK = "d2000000-0000-4000-8000-0000000000aa";
const BRANCH = "d2000000-0000-4000-8000-0000000000bb";
const SECRET = "spellbranch-local-dev-secret-change-me";

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return `${salt}:${hash}`;
}

test.beforeAll(async () => {
  const now = "2026-11-11T00:00:00.000Z";
  const deck = (id: string, name: string, forkedFromId: string | null) => ({
    id,
    ownerId: USER,
    name,
    format: "commander",
    notes: "",
    visibility: "private",
    allowForks: true,
    forkedFromId,
    copiedFromId: null,
    preferredBranchId: null,
    commander: null,
    colors: ["B"],
    createdAt: now,
    updatedAt: now,
  });
  const store = {
    users: [
      {
        id: USER,
        username: "mycards",
        displayName: "My Cards",
        email: "mycards@example.test",
        bio: "",
        avatarUrl: null,
        passwordHash: hashPassword("spellbranch-dev-only"),
        collectionVisibility: "private",
        createdAt: now,
      },
    ],
    friendships: [],
    favorites: [],
    decks: [deck(DECK, "Live and Burn", null), deck(BRANCH, "Side Path", DECK)],
    deckCards: [],
    deckCategories: [],
    deckTypeOrders: [],
    comments: [],
    collectionCards: [
      {
        id: "c2000000-0000-4000-8000-0000000000aa",
        userId: USER,
        scryfallId: "c2000000-0000-4000-8000-0000000000aa",
        cardName: "Lightning Bolt",
        imageUri: null,
        manaCost: "{R}",
        typeLine: "Instant",
        quantity: 4,
        finish: "nonfoil",
        condition: "NM",
        forTrade: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    sessions: {},
  };
  const dir = path.join(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "store.json"), JSON.stringify(store, null, 2));
});

test.beforeEach(async ({ context }) => {
  const token = await new SignJWT({
    id: USER,
    email: "mycards@example.test",
    username: "mycards",
    displayName: "My Cards",
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

async function overflowReport(page: Page) {
  return page.evaluate(() => {
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
}

test("my cards has no horizontal overflow on a phone", async ({ page }) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/my-cards");
    await expect(page.getByRole("heading", { name: "My cards" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Live and Burn" })).toBeVisible();
    let report = await overflowReport(page);
    expect(report.scroll, `decks ${width}px via ${report.past.join(" | ")}`).toBe(report.client);

    await page.goto("/my-cards?section=branches");
    await expect(page.getByRole("link", { name: "Side Path" })).toBeVisible();
    report = await overflowReport(page);
    expect(report.scroll, `branches ${width}px via ${report.past.join(" | ")}`).toBe(report.client);

    await page.goto("/my-cards?section=collection");
    await expect(page.getByText("Lightning Bolt", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to collection" })).toBeVisible();
    report = await overflowReport(page);
    expect(report.scroll, `collection ${width}px via ${report.past.join(" | ")}`).toBe(report.client);
  }
});

test("old decks list redirects and browse stays reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/decks");
  await expect(page).toHaveURL(/\/my-cards$/);
  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Browse decks" })).toBeVisible();
  const report = await overflowReport(page);
  expect(report.scroll, `browse via ${report.past.join(" | ")}`).toBe(report.client);
});

test("desktop my cards does not scroll horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/my-cards");
  await expect(page.getByRole("heading", { name: "My cards" })).toBeVisible();
  const report = await overflowReport(page);
  expect(report.scroll, `desktop via ${report.past.join(" | ")}`).toBe(report.client);
});

test("webkit screenshots of my cards sections", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dir = existsSync("/opt/cursor/artifacts") ? "/opt/cursor/artifacts" : "test-results/my-cards";
  mkdirSync(dir, { recursive: true });
  const hideDev = () => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.goto("/my-cards");
  await hideDev();
  await expect(page.getByRole("heading", { name: "My cards" })).toBeVisible();
  await page.screenshot({ path: `${dir}/webkit-390-my-cards-decks.png`, fullPage: true });
  await page.goto("/my-cards?section=branches");
  await hideDev();
  await expect(page.getByRole("link", { name: "Side Path" })).toBeVisible();
  await page.screenshot({ path: `${dir}/webkit-390-my-cards-branches.png`, fullPage: true });
  await page.goto("/my-cards?section=collection");
  await hideDev();
  await expect(page.getByText("Lightning Bolt", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${dir}/webkit-390-my-cards-collection.png`, fullPage: true });
});
