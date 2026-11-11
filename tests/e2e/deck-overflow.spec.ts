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

function card(
  id: string,
  name: string,
  typeLine: string,
  manaCost: string,
  board: "main" | "side" | "maybe" = "main",
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
    quantity: 1,
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
      card(
        "c1000000-0000-4000-8000-0000000000a3",
        "Viscera Seer",
        "Creature — Vampire Wizard",
        "{B}",
        "side",
      ),
      card(
        "c1000000-0000-4000-8000-0000000000a4",
        "Blood Artist",
        "Creature — Vampire",
        "{B}",
        "maybe",
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
    await expect(page.getByTestId("deck-header")).toContainText("1 commander + 2 cards");
    await expect(page.getByTestId("board-tab-main")).toContainText("2 cards");
    await expect(page.getByTestId("board-tab-side")).toContainText("1 card");
    await expect(page.getByTestId("board-tab-maybe")).toContainText("1 card");
    await expect(page.getByRole("button", { name: "Move Ayara, First of Locthwain to a category" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move Ayara, First of Locthwain to another board" })).toBeVisible();
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

    const boardMove = await page
      .getByRole("button", { name: "Move Ayara, First of Locthwain to another board" })
      .boundingBox();
    expect(boardMove).not.toBeNull();
    expect(boardMove!.x).toBeGreaterThanOrEqual(0);
    expect(boardMove!.x + boardMove!.width).toBeLessThanOrEqual(width + 1);
  }
});

test("desktop deck page does not scroll horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/decks/${DECK}`);
  await expect(page.getByRole("heading", { name: "Live and Burn" })).toBeVisible();
  await expect(page.getByTestId("board-switcher")).toBeVisible();
  const report = await overflowReport(page);
  expect(report.scroll, `desktop overflows via ${report.past.join(" | ")}`).toBe(report.client);
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
  await page.getByTestId("board-switcher").screenshot({ path: `${dir}/webkit-390-board-switcher.png` });
  const boardButton = page.getByRole("button", { name: "Move Ayara, First of Locthwain to another board" });
  await boardButton.scrollIntoViewIfNeeded();
  await boardButton.screenshot({ path: `${dir}/webkit-390-move-board-button.png` });
  await boardButton.click();
  await expect(page.getByTestId("move-board-sheet")).toBeVisible();
  // The dev overlay ("N issues") sits on top of the sheet in next dev.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.getByTestId("move-board-sheet").screenshot({ path: `${dir}/webkit-390-move-board.png` });
});
