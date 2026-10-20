import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// L3: every export of a "use server" file becomes a callable server action.
// Keep those files to mutations (named *Action) and keep read helpers and
// requireUser in server-only modules.
const srcDir = path.resolve(__dirname, "../src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const files = walk(srcDir).map((file) => ({ file, text: readFileSync(file, "utf8") }));
const useServerFiles = files.filter(({ text }) => /^\s*["']use server["'];?/.test(text));

describe("server action surface", () => {
  it("finds the action modules", () => {
    expect(useServerFiles.length).toBeGreaterThanOrEqual(5);
  });

  it.each(useServerFiles.map(({ file, text }) => [path.relative(srcDir, file), text]))(
    "%s only exports *Action functions (plus types)",
    (_name, text) => {
      const exported = [...text.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(
        (m) => m[1],
      );
      expect(exported.length).toBeGreaterThan(0);
      for (const name of exported) expect(name).toMatch(/Action$/);
      expect(text).not.toMatch(/^export\s+(const|let|var)\s/m);
    },
  );

  it("requireUser and the read helpers live in server-only modules", () => {
    for (const rel of [
      "lib/auth/require-user.ts",
      "lib/queries/decks.ts",
      "lib/queries/comments.ts",
      "lib/queries/favorites.ts",
      "lib/queries/friends.ts",
      "lib/queries/profiles.ts",
    ]) {
      const text = readFileSync(path.join(srcDir, rel), "utf8");
      expect(text.startsWith('import "server-only";'), rel).toBe(true);
      expect(text).not.toMatch(/^["']use server["']/m);
    }
  });

  it("nothing imports requireUser from an action module", () => {
    for (const { file, text } of files) {
      expect(text, path.relative(srcDir, file)).not.toMatch(
        /import\s*{[^}]*\brequireUser\b[^}]*}\s*from\s*["']@\/lib\/actions\//,
      );
    }
  });
});
