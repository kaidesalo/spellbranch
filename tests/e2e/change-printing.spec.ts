import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SignJWT } from "jose";

const USER = "a3000000-0000-4000-8000-0000000000aa";
const DECK = "d3000000-0000-4000-8000-0000000000aa";
const BOLT = "7673784e-db4b-43a1-8d55-1bb9fc1e284f";
const SECRET = "spellbranch-local-dev-secret-change-me";

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return `${salt}:${hash}`;
}

test.beforeAll(async () => {
  const now = "2026-11-11T00:00:00.000Z";
  const store = {
    users: [
      {
        id: USER,
        username: "prints",
        displayName: "Prints",
        email: "prints@example.test",
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
        name: "Bolt Pile",
        format: "modern",
        notes: "",
        visibility: "private",
        allowForks: false,
        forkedFromId: null,
        copiedFromId: null,
        preferredBranchId: null,
        commander: null,
        colors: ["R"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    deckCards: [
      {
        id: "c3000000-0000-4000-8000-0000000000aa",
        deckId: DECK,
        scryfallId: BOLT,
        cardName: "Lightning Bolt",
        imageUri: null,
        manaCost: "{R}",
        typeLine: "Instant",
        colors: ["R"],
        colorIdentity: ["R"],
        oracleText: null,
        quantity: 4,
        categoryId: null,
        board: "main",
        createdAt: now,
      },
    ],
    deckCategories: [],
    deckTypeOrders: [],
    comments: [],
    collectionCards: [
      {
        id: "c3000000-0000-4000-8000-0000000000bb",
        userId: USER,
        scryfallId: BOLT,
        cardName: "Lightning Bolt",
        imageUri: null,
        manaCost: "{R}",
        typeLine: "Instant",
        quantity: 2,
        finish: "nonfoil",
        condition: "NM",
        forTrade: false,
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
    email: "prints@example.test",
    username: "prints",
    displayName: "Prints",
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

test("printing picker fits on a phone and scrolls inside the sheet", async ({ page }) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/decks/${DECK}`);
    await expect(page.getByRole("heading", { name: "Bolt Pile" })).toBeVisible();
    await noOverflow(page, `deck ${width}`);
    await page.getByRole("button", { name: "Change printing of Lightning Bolt" }).click();
    const sheet = page.getByTestId("change-printing-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("printing-option").first()).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByTestId("printing-option").first()).toHaveAttribute("aria-current", "true");
    const image = sheet.locator("img").first();
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    expect(box, "printing image").not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(140);
    expect(box!.width).toBeLessThanOrEqual(210);
    expect(box!.height / box!.width).toBeGreaterThan(1.3);
    expect(box!.height / box!.width).toBeLessThan(1.5);
    if (width >= 375) {
      const tops = await sheet.getByTestId("printing-option").evaluateAll((els) =>
        els.slice(0, 2).map((el) => Math.round(el.getBoundingClientRect().top)),
      );
      expect(tops[0], `${width}px two columns`).toBe(tops[1]);
    }
    await sheet.getByTestId("printing-option").first().focus();
    await page.keyboard.press("Tab");
    await expect(sheet.getByTestId("printing-option").nth(1)).toBeFocused();
    await noOverflow(page, `picker ${width}`);
    const scrolls = await sheet.locator(".overflow-y-auto").evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
});

test("desktop printing picker does not widen the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/decks/${DECK}`);
  await page.getByRole("button", { name: "Change printing of Lightning Bolt" }).click();
  await expect(page.getByTestId("change-printing-sheet").getByTestId("printing-option").first()).toBeVisible({
    timeout: 20_000,
  });
  const image = page.getByTestId("change-printing-sheet").locator("img").first();
  const box = await image.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(146);
  expect(box!.width).toBeLessThanOrEqual(200);
  await noOverflow(page, "desktop picker");
});

test("collection picker shows finish choices on the tile", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/my-cards?section=collection");
  await page.getByRole("button", { name: "Change printing of Lightning Bolt" }).click();
  const sheet = page.getByTestId("change-printing-sheet");
  const multi = sheet.getByRole("button", { name: /Choose a finish for/ }).first();
  await expect(multi).toBeVisible({ timeout: 20_000 });
  await multi.click();
  await expect(sheet.getByRole("button", { name: "Nonfoil", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Foil", exact: true })).toBeVisible();
  await noOverflow(page, "collection finishes");
});

test("webkit screenshots of the printing tiles", async ({ page }) => {
  const dir = existsSync("/opt/cursor/artifacts") ? "/opt/cursor/artifacts" : "test-results/printings";
  mkdirSync(dir, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => undefined);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/decks/${DECK}`);
  await page.getByRole("button", { name: "Change printing of Lightning Bolt" }).click();
  const sheet = page.getByTestId("change-printing-sheet");
  await expect(sheet.locator("img").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => sheet.locator("img").first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await sheet.screenshot({ path: `${dir}/webkit-390-printing-tiles.png` });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/decks/${DECK}`);
  await page.getByRole("button", { name: "Change printing of Lightning Bolt" }).click();
  const wide = page.getByTestId("change-printing-sheet");
  await expect(wide.locator("img").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => wide.locator("img").first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await wide.screenshot({ path: `${dir}/desktop-1280-printing-tiles.png` });
});
