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

// Paths are relative to src/, with "/" separators.
const toPosix = (p: string) => p.split(path.sep).join("/");
const files = walk(srcDir).map((file) => ({
  rel: toPosix(path.relative(srcDir, file)),
  text: readFileSync(file, "utf8"),
}));

/**
 * Every src module a file imports (static, dynamic or re-export), as a path
 * relative to src/ without extension. "@/..." and relative imports resolve to
 * the same name, so "../rate-limit/keys" can't slip past (Cipher R4).
 */
function importsOf(rel: string, text: string): string[] {
  const specs = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]);
  return specs.flatMap((spec) => {
    let target: string;
    if (spec.startsWith("@/")) target = spec.slice(2);
    else if (spec.startsWith(".")) target = path.posix.join(path.posix.dirname(rel), spec);
    else return [];
    return [target.replace(/\.(ts|tsx|js)$/, "").replace(/\/index$/, "")];
  });
}

// A "use server" directive anywhere: at the top of a module, or inline in a
// server action closure inside a page (Cipher R4).
const USE_SERVER = /^\s*["']use server["'];?\s*$/m;
const useServerFiles = files.filter(({ text }) => USE_SERVER.test(text));
const INTERNALS = ["store", "memory-store", "postgres-store", "keys"].map((m) => `lib/rate-limit/${m}`);
const SERVICE = "lib/supabase/service";
// The only modules allowed to use the secret-key client (Cipher F4).
const SERVICE_IMPORTERS = ["lib/rate-limit/index.ts", "lib/supabase/username.ts"];
// Names a "use server" file must never hand to the client as an action.
const PRIVATE_NAMES = "limit|limitError|requestIp|setRateLimitStoreForTests|rateLimitHit|usernameAvailable";

describe("rate-limit boundary", () => {
  it("resolves alias and relative imports to the same module", () => {
    const text = [
      'import { a } from "@/lib/rate-limit/keys";',
      'import { b } from "../rate-limit/keys";',
      'export { c } from "../../lib/supabase/service";',
      'const d = await import("./username");',
      'import "server-only";',
    ].join("\n");
    expect(importsOf("lib/actions/auth.ts", text)).toEqual([
      "lib/rate-limit/keys",
      "lib/rate-limit/keys",
      "lib/supabase/service",
      "lib/actions/username",
    ]);
  });

  it("only src/lib/rate-limit imports the stores and keys", () => {
    const offenders = files
      .filter(({ rel }) => !rel.startsWith("lib/rate-limit/"))
      .filter(({ rel, text }) => importsOf(rel, text).some((m) => INTERNALS.includes(m)))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("only the limiter and the username check import the secret-key client", () => {
    const importers = files
      .filter(({ rel, text }) => importsOf(rel, text).includes(SERVICE))
      .map(({ rel }) => rel)
      .sort();
    expect(importers).toEqual([...SERVICE_IMPORTERS].sort());
  });

  it("finds the inline \"use server\" closures as well as the action modules", () => {
    const rels = useServerFiles.map(({ rel }) => rel);
    expect(rels).toContain("lib/actions/auth.ts");
    expect(rels).toContain("app/favorites/page.tsx");
  });

  it.each(useServerFiles.map(({ rel, text }) => [rel, text]))(
    "%s doesn't import the secret-key client or re-export the limiter",
    (rel, text) => {
      expect(importsOf(rel, text)).not.toContain(SERVICE);
      expect(text).not.toMatch(/export\s+(\*|\{[^}]*\})\s+from\s+["'][^"']*(rate-limit|supabase\/service)/);
      expect(text).not.toMatch(new RegExp(`export\\s+\\{[^}]*\\b(${PRIVATE_NAMES})\\b`));
      expect(text).not.toMatch(new RegExp(`export\\s+(const|let|var)\\s+\\w+\\s*=\\s*(${PRIVATE_NAMES})\\b`));
    },
  );

  it("every module in src/lib/rate-limit is server-only", () => {
    const modules = files.filter(({ rel }) => rel.startsWith("lib/rate-limit/"));
    expect(modules.length).toBeGreaterThan(5);
    for (const { rel, text } of modules) expect(text, rel).toMatch(/^import "server-only";/);
  });

  it("the secret-key client is server-only, session-less and never touches auth", () => {
    const service = readFileSync(path.join(srcDir, "lib/supabase/service.ts"), "utf8");
    expect(service).toMatch(/^import "server-only";/);
    expect(service).toMatch(/persistSession:\s*false/);
    const code = service.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.auth\b/);
    expect(service).not.toMatch(/^\s*["']use server["']/m);
  });

  it("only service.ts and config.ts read SUPABASE_SECRET_KEY", () => {
    const readers = files
      .filter(({ text }) => /\.SUPABASE_SECRET_KEY\b/.test(text))
      .map(({ rel }) => rel)
      .sort();
    expect(readers).toEqual(["lib/supabase/config.ts", "lib/supabase/service.ts"]);
  });

  it("no NEXT_PUBLIC_ variable is named like a secret", () => {
    const offenders = files.filter(({ text }) => /NEXT_PUBLIC_\w*SECRET/.test(text)).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("only service.ts creates a plain supabase-js client", () => {
    const offenders = files
      .filter(({ text }) => /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*["']@supabase\/supabase-js["']/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual(["lib/supabase/service.ts"]);
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

    // Relative paths are caught too (Cipher R4).
    const relative = (spec: string) => `import * as m from "${spec}";\nexport const x = m;\n`;
    expect(await lint("src/lib/actions/example.ts", relative("../rate-limit/keys"))).toBe(1);
    expect(await lint("src/lib/actions/example.ts", relative("../rate-limit/memory-store.js"))).toBe(1);
    expect(await lint("src/lib/data/example.ts", relative("../supabase/service"))).toBe(1);
    expect(await lint("src/app/example/page.tsx", relative("../../lib/supabase/service"))).toBe(1);
    expect(await lint("src/lib/supabase/server.ts", relative("./service"))).toBe(1);
    expect(await lint("src/lib/rate-limit/keys.ts", relative("../supabase/service"))).toBe(1);
    expect(await lint("src/lib/supabase/username.ts", relative("./service"))).toBe(0);
    expect(await lint("src/lib/rate-limit/index.ts", relative("../supabase/service"))).toBe(0);
    // A different "./store" (src/lib/data/store.ts) is fine.
    expect(await lint("src/lib/data/example.ts", relative("./store"))).toBe(0);

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
