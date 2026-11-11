import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SignJWT } from "jose";

const USER = "a1000000-0000-4000-8000-0000000000aa";
const DECK = "d1000000-0000-4000-8000-0000000000aa";
const SECRET = "spellbranch-local-dev-secret-change-me";

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return `${salt}:${hash}`;
}

function card(id: string, name: string, typeLine: string, manaCost: string) {
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
    quantity: 1,
    categoryId: null,
    createdAt: "2026-11-11T00:00:00.000Z",
  };
}

test.beforeAll(async () => {
  const now = "2026-11-11T00:00:00.000Z";
  const store = {
    users: [
      {
        id: USER,
        username: "overflow",
        displayName: "Overflow",
        email: "overflow@example.test",
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
        name: "Live and Burn",
        format: "commander",
        notes: "",
        visibility: "private",
        allowForks: true,
        forkedFromId: null,
        copiedFromId: null,
        preferredBranchId: null,
        commander: {
          scryfallId: "gisa",
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
      card(
        "c1000000-0000-4000-8000-0000000000a1",
        "Ayara, First of Locthwain",
        "Legendary Creature — Elf Noble",
        "{B}{B}{B}",
      ),
      card(
        "c1000000-0000-4000-8000-0000000000a2",
        "Champion of the Perished",
        "Creature — Zombie",
        "{B}",
      ),
    ],
    deckCategories: [],
    deckTypeOrders: [],
    comments: [],
    sessions: {},
  };
  const dir = path.join(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "store.json"), JSON.stringify(store, null, 2));
});

test.beforeEach(async ({ context }) => {
  const token = await new SignJWT({
    id: USER,
    email: "overflow@example.test",
    username: "overflow",
    displayName: "Overflow",
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

async function overflowReport(page: import("@playwright/test").Page) {
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

test("deck page does not scroll horizontally on a phone", async ({ page }) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/decks/${DECK}`);
    await expect(page.getByRole("heading", { name: "Live and Burn" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move Ayara, First of Locthwain to a category" })).toBeVisible();
    const report = await overflowReport(page);
    expect(report.scroll, `${width}px overflows via ${report.past.join(" | ")}`).toBe(report.client);

    const move = await page
      .getByRole("button", { name: "Move Ayara, First of Locthwain to a category" })
      .boundingBox();
    expect(move).not.toBeNull();
    expect(move!.x).toBeGreaterThanOrEqual(0);
    expect(move!.x + move!.width).toBeLessThanOrEqual(width + 1);

    const categories = await page.getByRole("button", { name: "Categories" }).boundingBox();
    expect(categories).not.toBeNull();
    expect(categories!.x + categories!.width).toBeLessThanOrEqual(width + 1);
  }
});

test("webkit screenshots of the fitted deck page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/decks/${DECK}`);
  await expect(page.getByRole("heading", { name: "Live and Burn" })).toBeVisible();
  const dir = existsSync("/opt/cursor/artifacts") ? "/opt/cursor/artifacts" : "test-results/overflow";
  mkdirSync(dir, { recursive: true });
  await page.getByTestId("deck-header").screenshot({ path: `${dir}/webkit-390-deck-header.png` });
  await page.locator("section[aria-labelledby='commander-heading']").screenshot({
    path: `${dir}/webkit-390-commander.png`,
  });
  await page.getByRole("heading", { name: "Deck list" }).scrollIntoViewIfNeeded();
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "Deck list" }) }).screenshot({
    path: `${dir}/webkit-390-deck-rows.png`,
  });
});
