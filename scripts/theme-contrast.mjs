// WCAG 2.x contrast check for the Lost Century theme (src/app/globals.css).
//
//   node scripts/theme-contrast.mjs        prints a Markdown table, exits 1 on a failure
//
// tests/theme-contrast.test.ts runs the same checks under `npm test`.
// Pairs list the foreground first, then the surface it sits on. A surface can be
// a stack of translucent layers ({ color, alpha }) composited over an opaque
// base, the way Tailwind's `bg-card/70` or a gradient glow renders.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Lost Century by SurrealEmber, https://lospec.com/palette-list/lost-century */
export const LOST_CENTURY = [
  "#d1b187", "#c77b58", "#ae5d40", "#79444a", "#4b3d44", "#ba9158", "#927441", "#4d4539",
  "#77743b", "#b3a555", "#d2c9a5", "#8caba1", "#4b726e", "#574852", "#847875", "#ab9b8e",
];

/** Custom properties of the first `:root { ... }` block in globals.css. */
export function readRootTokens(css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8")) {
  const block = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error("No :root block in globals.css");
  const tokens = {};
  for (const m of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

function rgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Composite `top` at `alpha` over the opaque `base` (both [r, g, b]). */
function over(top, alpha, base) {
  return top.map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha)));
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `spec` is a token name, a hex color, or [base, ...{ color, alpha }] layers.
 * A foreground can also be { color, alpha } over the resolved surface.
 */
function resolve(spec, tokens, surface) {
  const color = (c) => rgb(c.startsWith("#") ? c : tokens[c] ?? (() => { throw new Error(`Unknown token ${c}`); })());
  if (typeof spec === "string") return color(spec);
  if (Array.isArray(spec)) {
    const [base, ...layers] = spec;
    return layers.reduce((acc, l) => over(color(l.color), l.alpha, acc), color(base));
  }
  return over(color(spec.color), spec.alpha, surface);
}

const AA = 4.5;
const LARGE = 3; // large text (>= 24px, or >= 18.66px bold) and UI component boundaries

/** [label, foreground, surface, minimum ratio] */
export const PAIRS = [
  ["foreground / background", "foreground", "background", AA],
  ["foreground / background + teal glow (top left)", "foreground", ["background", { color: "#4b726e", alpha: 0.12 }], AA],
  ["foreground / background + terracotta glow (top right)", "foreground", ["background", { color: "#c77b58", alpha: 0.14 }], AA],
  ["foreground / header (background/90)", "foreground", ["background", { color: "background", alpha: 0.9 }], AA],
  ["card-foreground / card", "card-foreground", "card", AA],
  ["card-foreground / card/70 over background", "card-foreground", ["background", { color: "card", alpha: 0.7 }], AA],
  ["popover-foreground / popover", "popover-foreground", "popover", AA],
  ["primary-foreground / primary", "primary-foreground", "primary", AA],
  ["primary-foreground/80 / primary (selected search result detail)", { color: "primary-foreground", alpha: 0.8 }, "primary", AA],
  ["primary (text, links) / background", "primary", "background", AA],
  ["primary (text) / card", "primary", "card", AA],
  ["secondary-foreground / secondary", "secondary-foreground", "secondary", AA],
  ["muted-foreground / muted", "muted-foreground", "muted", AA],
  ["muted-foreground / background", "muted-foreground", "background", AA],
  ["muted-foreground / card", "muted-foreground", "card", AA],
  ["muted-foreground / secondary", "muted-foreground", "secondary", AA],
  ["accent-foreground / accent", "accent-foreground", "accent", AA],
  ["foreground / muted (outline button hover)", "foreground", "muted", AA],
  ["destructive (text) / background", "destructive", "background", AA],
  ["destructive (text) / card", "destructive", "card", AA],
  ["destructive-foreground / destructive (destructive button, badge)", "destructive-foreground", "destructive", AA],
  ["destructive-foreground / primary (destructive button hover)", "destructive-foreground", "primary", AA],
  ["destructive (alert text) / card", "destructive", "card", AA],
  ["sidebar-foreground / sidebar", "sidebar-foreground", "sidebar", AA],
  ["sidebar-primary-foreground / sidebar-primary", "sidebar-primary-foreground", "sidebar-primary", AA],
  ["sidebar-accent-foreground / sidebar-accent", "sidebar-accent-foreground", "sidebar-accent", AA],
  ["input border / background (UI)", "input", "background", LARGE],
  ["input border / card (UI)", "input", "card", LARGE],
  ["ring / background (UI, focus)", "ring", "background", LARGE],
  ["ring / card (UI, focus)", "ring", "card", LARGE],
  ["sidebar-ring / sidebar (UI, focus)", "sidebar-ring", "sidebar", LARGE],
  // Hardcoded chrome outside the tokens.
  ["home hero text #d2c9a5 / #4b3d44", "#d2c9a5", "#4b3d44", AA],
  ["home hero text #d2c9a5 / #4d4539", "#d2c9a5", "#4d4539", AA],
  ["home hero label #d2c9a5 / #574852 + rust glow", "#d2c9a5", ["#574852", { color: "#ae5d40", alpha: 0.2 }], AA],
  ["home hero text #d2c9a5 / #4b3d44 + teal glow", "#d2c9a5", ["#4b3d44", { color: "#4b726e", alpha: 0.25 }], AA],
  ["home hero text #d2c9a5 / #574852 + teal glow", "#d2c9a5", ["#574852", { color: "#4b726e", alpha: 0.25 }], AA],
  ["home hero muted #d1b187 / #4d4539", "#d1b187", "#4d4539", AA],
  ["home hero dots #8caba1 / #4b3d44 (UI)", "#8caba1", "#4b3d44", LARGE],
  ["home hero dots #c77b58 / #4b3d44 (UI)", "#c77b58", "#4b3d44", LARGE],
  ["home hero dots #b3a555 / #4b3d44 (UI)", "#b3a555", "#4b3d44", LARGE],
  ["/auth/confirm text #d2c9a5 / #4b3d44", "#d2c9a5", "#4b3d44", AA],
  ["/auth/confirm paragraph #d1b187 / #4b3d44", "#d1b187", "#4b3d44", AA],
  ["/auth/confirm button #4b3d44 / #d2c9a5", "#4b3d44", "#d2c9a5", AA],
];

/**
 * @param {Record<string, string>} [tokens]
 * @returns {{ label: string, ratio: number, min: number, pass: boolean }[]}
 */
export function checkContrast(tokens = readRootTokens()) {
  return PAIRS.map(([label, fg, bg, min]) => {
    if (typeof label !== "string" || typeof min !== "number") throw new Error("Bad pair");
    const surface = resolve(bg, tokens);
    const ratio = contrast(resolve(fg, tokens, surface), surface);
    return { label, ratio: Math.round(ratio * 100) / 100, min, pass: ratio >= min };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const rows = checkContrast();
  console.log("| Pair | Ratio | Needs | Result |\n|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.label} | ${r.ratio.toFixed(2)}:1 | ${r.min}:1 | ${r.pass ? "pass" : "FAIL"} |`);
  }
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length - failed}/${rows.length} pairs pass.`);
  process.exitCode = failed ? 1 : 0;
}
