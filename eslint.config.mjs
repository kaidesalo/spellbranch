import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Review M1 / Cipher F4: callers go through limit() in @/lib/rate-limit, never
// a store, the HMAC keys or (once it exists) the secret-key Supabase client.
const rateLimitInternals = {
  group: [
    "@/lib/rate-limit/store",
    "@/lib/rate-limit/memory-store",
    "@/lib/rate-limit/postgres-store",
    "@/lib/rate-limit/keys",
  ],
  message: "Use limit() from @/lib/rate-limit instead (review M1, Cipher F4).",
};
const secretKeyClient = {
  group: ["@/lib/supabase/service"],
  message: "The secret-key client is only for @/lib/rate-limit and the username check (Cipher F4).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/rate-limit/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [rateLimitInternals] }] },
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/lib/actions/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [rateLimitInternals, secretKeyClient] }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
