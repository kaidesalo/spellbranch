import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Review M1/I2, Cipher F4: only src/lib/rate-limit touches the stores and keys,
// only two modules touch the secret-key client, "use server" files never
// expose either, and both stay server-only. scripts/secret-canary.sh checks
// the built browser bundle.
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
const INTERNALS = /from\s+["']@\/lib\/rate-limit\/(store|memory-store|postgres-store|keys)["']/;
const SERVICE = /from\s+["']@\/lib\/supabase\/service["']/;
// The only modules allowed to use the secret-key client (Cipher F4).
const SERVICE_IMPORTERS = ["lib/rate-limit/index.ts", "lib/supabase/username.ts"].map((f) => path.normalize(f));

describe("rate-limit boundary", () => {
  it("only src/lib/rate-limit imports the stores and keys", () => {
    const offenders = files
      .filter(({ rel }) => !rel.startsWith(`lib${path.sep}rate-limit${path.sep}`))
      .filter(({ text }) => INTERNALS.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("only the limiter and the username check import the secret-key client", () => {
    const importers = files.filter(({ text }) => SERVICE.test(text)).map(({ rel }) => rel).sort();
    expect(importers).toEqual([...SERVICE_IMPORTERS].sort());
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

  it("the secret-key client is server-only, session-less and never touches auth", () => {
    const service = readFileSync(path.join(srcDir, "lib/supabase/service.ts"), "utf8");
    expect(service).toMatch(/^import "server-only";/);
    expect(service).toMatch(/persistSession:\s*false/);
    const code = service.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.auth\b/);
    expect(service).not.toMatch(/^\s*["']use server["']/m);
  });

  it("no \"use server\" file imports the secret-key client", () => {
    const offenders = useServerFiles.filter(({ text }) => SERVICE.test(text)).map(({ rel }) => rel);
    expect(useServerFiles.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("only service.ts and config.ts read SUPABASE_SECRET_KEY", () => {
    const readers = files
      .filter(({ text }) => /\.SUPABASE_SECRET_KEY\b/.test(text))
      .map(({ rel }) => rel)
      .sort();
    expect(readers).toEqual(["lib/supabase/config.ts", "lib/supabase/service.ts"].map((f) => path.normalize(f)));
  });

  it("no NEXT_PUBLIC_ variable is named like a secret", () => {
    const offenders = files.filter(({ text }) => /NEXT_PUBLIC_\w*SECRET/.test(text)).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("only service.ts creates a plain supabase-js client", () => {
    const offenders = files
      .filter(({ text }) => /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*["']@supabase\/supabase-js["']/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([path.normalize("lib/supabase/service.ts")]);
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
    const lint = async (filePath: string, code: string, ruleId = "no-restricted-imports") => {
      const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
      return result.messages.filter((m) => m.ruleId === ruleId).length;
    };
    const storeImport = 'import { MemoryStore } from "@/lib/rate-limit/memory-store";\nexport const s = MemoryStore;\n';
    const serviceImport = 'import * as service from "@/lib/supabase/service";\nexport const s = service;\n';

    expect(await lint("src/lib/actions/example.ts", storeImport)).toBe(1);
    expect(await lint("src/lib/data/example.ts", storeImport)).toBe(1);
    expect(await lint("src/lib/actions/example.ts", serviceImport)).toBe(1);
    expect(await lint("src/app/example/route.ts", serviceImport)).toBe(1);
    // The secret-key client: everywhere else, including the rest of the
    // limiter and the cookie-based Supabase helpers, is refused.
    expect(await lint("src/lib/data/supabase.ts", serviceImport)).toBe(1);
    expect(await lint("src/lib/supabase/server.ts", serviceImport)).toBe(1);
    expect(await lint("src/lib/rate-limit/postgres-store.ts", serviceImport)).toBe(1);
    expect(await lint("src/components/example.tsx", serviceImport)).toBe(1);
    expect(await lint("src/lib/rate-limit/index.ts", serviceImport)).toBe(0);
    expect(await lint("src/lib/supabase/username.ts", serviceImport)).toBe(0);
    expect(await lint("src/lib/supabase/username.ts", storeImport)).toBe(1);

    // A second plain supabase-js client, or reading the key somewhere new.
    const plainClient = 'import { createClient } from "@supabase/supabase-js";\nexport const c = createClient;\n';
    const keyRead = "export const k = process.env.SUPABASE_SECRET_KEY;\n";
    expect(await lint("src/lib/data/example.ts", plainClient)).toBe(1);
    expect(await lint("src/lib/rate-limit/index.ts", plainClient)).toBe(1);
    expect(await lint("src/lib/supabase/service.ts", plainClient)).toBe(0);
    expect(await lint("src/lib/data/example.ts", keyRead, "no-restricted-syntax")).toBe(1);
    expect(await lint("src/lib/rate-limit/index.ts", keyRead, "no-restricted-syntax")).toBe(1);
    expect(await lint("src/lib/supabase/service.ts", keyRead, "no-restricted-syntax")).toBe(0);

    expect(await lint("src/lib/rate-limit/example.ts", storeImport)).toBe(0);
    expect(await lint("src/lib/actions/example.ts", 'import { limit } from "@/lib/rate-limit";\nexport const l = limit;\n')).toBe(0);
  }, 30_000);
});
