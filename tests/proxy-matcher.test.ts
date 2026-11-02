import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

// Review R1: the CSP proxy must run for every HTML response, including 404s
// for paths that merely look like assets (/nope.png). It may skip only Next's
// static chunks, the image optimizer, the favicon and the real public/ files.

// Next compiles the matcher with path-to-regexp; for this single
// "/(<regex>)" source that is the regex anchored at both ends.
const source = config.matcher[0];
const inner = source.slice(2, -1); // strip leading "/(" and trailing ")"
const re = new RegExp(`^/(?:${inner})$`);
const runsOn = (p: string) => re.test(p);

// Every served file under public/, as a URL path like "next.svg" or "mana/W.svg".
const publicDir = path.resolve(__dirname, "../public");
const publicFiles = readdirSync(publicDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(publicDir, path.join(entry.parentPath, entry.name)))
  .map((file) => file.split(path.sep).join("/"));

describe("proxy matcher (R1)", () => {
  it.each([
    "/",
    "/dashboard",
    "/decks/123",
    "/nope.png",
    "/decks/x.js",
    "/anything.txt",
    "/missing.css",
    "/favicon.ico.html",
    "/next.svg/x",
    "/sub/next.svg",
    "/_next/imagefoo",
    "/auth/confirm",
    "/mana",
    "/mana/",
    "/mana/nope.png",
    "/mana/w.svg",
    "/mana/W.svg/x",
  ])("runs on %s", (p) => {
    expect(runsOn(p)).toBe(true);
  });

  it.each(["/_next/static/chunks/main.js", "/_next/static/css/app.css", "/_next/image", "/favicon.ico", "/mana/W.svg", "/mana/WUP.svg"])(
    "skips %s",
    (p) => {
      expect(runsOn(p)).toBe(false);
    },
  );

  it("skips exactly the files in public/", () => {
    expect(publicFiles.length).toBeGreaterThan(0);
    for (const file of publicFiles) expect(runsOn(`/${file}`), file).toBe(false);
  });
});
