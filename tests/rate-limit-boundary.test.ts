import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Review M1 / Cipher F4: only src/lib/rate-limit touches the stores and keys,
// "use server" files never expose limit() or the secret-key client, and the
// limiter stays server-only.
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const files = walk(srcDir).map((file) => ({
  rel: path.relative(srcDir, file),
  text: readFileSync(file, "utf8"),
}));
const useServerFiles = files.filter(({ text }) => /^\s*["']use server["'];?/.test(text));
const INTERNALS = /from\s+["']@\/lib\/(rate-limit\/(store|memory-store|postgres-store|keys)|supabase\/service)["']/;

describe("rate-limit boundary", () => {
  it("only src/lib/rate-limit imports the stores and keys", () => {
    const offenders = files
      .filter(({ rel }) => !rel.startsWith(`lib${path.sep}rate-limit${path.sep}`))
      .filter(({ text }) => INTERNALS.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it.each(useServerFiles.map(({ rel, text }) => [rel, text]))(
    "%s doesn't re-export the limiter or the secret-key client",
    (_rel, text) => {
      expect(text).not.toMatch(/export\s+(\*|\{[^}]*\})\s+from\s+["']@\/lib\/(rate-limit|supabase\/service)/);
      expect(text).not.toMatch(/export\s+\{[^}]*\b(limit|limitError|requestIp|setRateLimitStoreForTests)\b/);
    },
  );

  it("the limiter's entry point is server-only", () => {
    const index = readFileSync(path.join(srcDir, "lib/rate-limit/index.ts"), "utf8");
    expect(index).toMatch(/^import "server-only";/);
  });

  it("client components never import the limiter", () => {
    const clientFiles = files.filter(({ text }) => /^\s*["']use client["'];?/.test(text));
    expect(clientFiles.length).toBeGreaterThan(0);
    const offenders = clientFiles
      .filter(({ text }) => /from\s+["']@\/lib\/rate-limit/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("ESLint rejects store and secret-key imports outside src/lib/rate-limit", async () => {
    const eslint = new ESLint({ cwd: root });
    const lint = async (filePath: string, code: string) => {
      const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
      return result.messages.filter((m) => m.ruleId === "no-restricted-imports").length;
    };
    const storeImport = 'import { MemoryStore } from "@/lib/rate-limit/memory-store";\nexport const s = MemoryStore;\n';
    const serviceImport = 'import * as service from "@/lib/supabase/service";\nexport const s = service;\n';

    expect(await lint("src/lib/actions/example.ts", storeImport)).toBe(1);
    expect(await lint("src/lib/data/example.ts", storeImport)).toBe(1);
    expect(await lint("src/lib/actions/example.ts", serviceImport)).toBe(1);
    expect(await lint("src/app/example/route.ts", serviceImport)).toBe(1);
    expect(await lint("src/lib/rate-limit/example.ts", storeImport)).toBe(0);
    expect(await lint("src/lib/actions/example.ts", 'import { limit } from "@/lib/rate-limit";\nexport const l = limit;\n')).toBe(0);
  }, 30_000);
});
