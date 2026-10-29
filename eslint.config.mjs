import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Review M1/I2, Cipher F4: callers go through limit() in @/lib/rate-limit, never
// a store or the HMAC keys, and the secret-key Supabase client stays behind
// exactly two modules. tests/rate-limit-boundary.test.ts checks these rules fire.
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
  message:
    "The secret-key client is only for src/lib/rate-limit/index.ts and src/lib/supabase/username.ts (Cipher F4).",
};
const plainSupabaseClient = {
  name: "@supabase/supabase-js",
  importNames: ["createClient"],
  message:
    "Use the clients in src/lib/supabase (server.ts, client.ts). Only service.ts creates a plain supabase-js client (Cipher F4).",
};

// One no-restricted-imports entry per file group. In flat config a later block
// replaces the rule's options for the files it matches, so each block lists
// everything that applies to its files.
function restrictImports(patterns) {
  return { "no-restricted-imports": ["error", { patterns, paths: [plainSupabaseClient] }] };
}

const SERVICE = "src/lib/supabase/service.ts";
const USERNAME_CHECK = "src/lib/supabase/username.ts";
const LIMITER = "src/lib/rate-limit/index.ts";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/rate-limit/**", USERNAME_CHECK, SERVICE],
    rules: restrictImports([rateLimitInternals, secretKeyClient]),
  },
  {
    // Inside the limiter only its entry point may use the secret-key client.
    files: ["src/lib/rate-limit/**/*.{ts,tsx}"],
    ignores: [LIMITER],
    rules: restrictImports([secretKeyClient]),
  },
  { files: [LIMITER], rules: restrictImports([]) },
  { files: [USERNAME_CHECK], rules: restrictImports([rateLimitInternals]) },
  {
    files: [SERVICE],
    rules: { "no-restricted-imports": ["error", { patterns: [rateLimitInternals] }] },
  },
  {
    // The secret key is read in service.ts (to use it) and config.ts (to
    // check it at startup), nowhere else.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [SERVICE, "src/lib/supabase/config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='SUPABASE_SECRET_KEY']",
          message: "Only src/lib/supabase/service.ts and config.ts read SUPABASE_SECRET_KEY (Cipher F4).",
        },
      ],
    },
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
