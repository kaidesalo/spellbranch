// WCAG 2.x contrast check for the Spellbranch theme (src/app/globals.css).
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

/**
 * Spellbranch brand colors, plus the one error red.
 * Midnight navy, slate navy, blue-gray, warm parchment, mist gray, muted gold.
 * #f07167 is only for error text and destructive buttons.
 */
export const SPELLBRANCH = [
  "#10141f", "#1a2232", "#344158", "#f4ebdd", "#abb7c9", "#e8b76a", "#f07167",
];

/**
 * Light mode. Parchment, cream cards, navy ink, antique gold, and the same
 * blue-gray for secondary text. #9b2c24 is the light-mode error red (the
 * bright #f07167 fails on parchment). #8c7b66 is the warm border.
 */
export const LIGHT_PALETTE = [
  "#f7f1e6", "#fffcf7", "#10141f", "#7a4e10", "#e4d8c4", "#344158", "#9b2c24", "#8c7b66",
];

/** Custom properties of the first block that starts with `selector {`. */
export function readTokenBlock(selector, css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8")) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(escaped + "\\s*\\{([\\s\\S]*?)\\n\\}"));
  if (!block) throw new Error(`No ${selector} block in globals.css`);
  const tokens = {};
  for (const m of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

/** Light tokens (`:root`). */
export function readRootTokens(css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8")) {
  return readTokenBlock(":root", css);
}

/** Dark tokens (`.dark`), the original Spellbranch palette. */
export function readDarkTokens(css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8")) {
  return readTokenBlock(".dark", css);
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
  ["foreground / header (background/90)", "foreground", ["background", { color: "background", alpha: 0.9 }], AA],
  ["card-foreground / card", "card-foreground", "card", AA],
  ["card-foreground / card/70 over background", "card-foreground", ["background", { color: "card", alpha: 0.7 }], AA],
  ["popover-foreground / popover", "popover-foreground", "popover", AA],
  ["primary-foreground / primary (gold button, active tab)", "primary-foreground", "primary", AA],
  ["primary-foreground/80 / primary (selected search detail)", { color: "primary-foreground", alpha: 0.8 }, "primary", AA],
  ["primary (gold text, links) / background", "primary", "background", AA],
  ["primary (gold text) / card", "primary", "card", AA],
  ["primary (gold text) / secondary", "primary", "secondary", AA],
  ["primary (active nav) / primary over background", "primary-foreground", ["background", { color: "primary", alpha: 1 }], AA],
  ["secondary-foreground / secondary", "secondary-foreground", "secondary", AA],
  ["muted-foreground / muted (inactive tab)", "muted-foreground", "muted", AA],
  ["muted-foreground / background", "muted-foreground", "background", AA],
  ["muted-foreground / card", "muted-foreground", "card", AA],
  ["muted-foreground / secondary", "muted-foreground", "secondary", AA],
  ["accent-foreground / accent", "accent-foreground", "accent", AA],
  ["foreground / muted (outline hover on page)", "foreground", "muted", AA],
  ["foreground (nav hover) / secondary", "foreground", "secondary", AA],
  ["foreground (active tab label sits on primary)", "primary-foreground", "primary", AA],
  ["destructive (text) / background", "destructive", "background", AA],
  ["destructive (text) / card", "destructive", "card", AA],
  ["destructive-foreground / destructive (button, badge)", "destructive-foreground", "destructive", AA],
  ["destructive-foreground / primary (destructive button hover)", "destructive-foreground", "primary", AA],
  ["sidebar-foreground / sidebar", "sidebar-foreground", "sidebar", AA],
  ["sidebar-primary-foreground / sidebar-primary", "sidebar-primary-foreground", "sidebar-primary", AA],
  ["sidebar-accent-foreground / sidebar-accent", "sidebar-accent-foreground", "sidebar-accent", AA],
  // Brand blue-gray borders are the specified hex and sit close to the navies.
  // Focus rings are gold at 50% opacity and have to clear the 3:1 UI minimum.
  ["ring at 50% / background (focus)", { color: "ring", alpha: 0.5 }, "background", LARGE],
  ["ring at 50% / card (focus)", { color: "ring", alpha: 0.5 }, "card", LARGE],
  ["sidebar-ring at 50% / sidebar (focus)", { color: "sidebar-ring", alpha: 0.5 }, "sidebar", LARGE],
  // Home hero illustration, painted with the same six colors.
  ["home hero text #f4ebdd / #10141f", "#f4ebdd", "#10141f", AA],
  ["home hero text #f4ebdd / #1a2232", "#f4ebdd", "#1a2232", AA],
  ["home hero text #f4ebdd / #1a2232 + gold glow", "#f4ebdd", ["#1a2232", { color: "#e8b76a", alpha: 0.22 }], AA],
  ["home hero muted #abb7c9 / #10141f", "#abb7c9", "#10141f", AA],
  ["home hero muted #abb7c9 / #1a2232", "#abb7c9", "#1a2232", AA],
  ["home hero dot gold / #10141f (UI)", "#e8b76a", "#10141f", LARGE],
  ["home hero dot parchment / #10141f (UI)", "#f4ebdd", "#10141f", LARGE],
  ["home hero dot mist / #10141f (UI)", "#abb7c9", "#10141f", LARGE],
  // Light branch view: white panel, navy ink, antique-gold and slate marks.
  ["home hero light text #10141f / #ffffff", "#10141f", "#ffffff", AA],
  ["home hero light muted #344158 / #ffffff", "#344158", "#ffffff", AA],
  ["home hero light gold #7a4e10 / #ffffff", "#7a4e10", "#ffffff", AA],
  ["home hero light dot navy / #ffffff (UI)", "#10141f", "#ffffff", LARGE],
  ["home hero light dot gold / #ffffff (UI)", "#7a4e10", "#ffffff", LARGE],
  ["home hero light dot slate / #ffffff (UI)", "#344158", "#ffffff", LARGE],
  ["/auth/confirm dark text #f4ebdd / #10141f", "#f4ebdd", "#10141f", AA],
  ["/auth/confirm dark paragraph #abb7c9 / #10141f", "#abb7c9", "#10141f", AA],
  ["/auth/confirm dark button #10141f / #e8b76a", "#10141f", "#e8b76a", AA],
  ["/auth/confirm light text #10141f / #f7f1e6", "#10141f", "#f7f1e6", AA],
  ["/auth/confirm light paragraph #344158 / #f7f1e6", "#344158", "#f7f1e6", AA],
  ["/auth/confirm light button #fffcf7 / #7a4e10", "#fffcf7", "#7a4e10", AA],
  // Badge fills are the same in both themes (white or navy on a solid chip).
  ["compare added badge #ffffff / #047857", "#ffffff", "#047857", AA],
  ["compare removed badge #ffffff / #be123c", "#ffffff", "#be123c", AA],
  ["compare quantity badge #10141f / #d97706", "#10141f", "#d97706", AA],
];

/** Glows and compare text that only sit on the navy surfaces. */
const DARK_PAIRS = [
  ["foreground / background + gold glow", "foreground", ["background", { color: "#e8b76a", alpha: 0.14 }], AA],
  ["foreground / background + blue-gray glow", "foreground", ["background", { color: "#344158", alpha: 0.55 }], AA],
  ["compare added #6ee7b7 / background", "#6ee7b7", "background", AA],
  ["compare added #6ee7b7 / card", "#6ee7b7", "card", AA],
  ["compare removed #fda4af / background", "#fda4af", "background", AA],
  ["compare removed #fda4af / card", "#fda4af", "card", AA],
  ["compare quantity #fcd34d / background", "#fcd34d", "background", AA],
  ["compare added text / emerald wash on background", "#6ee7b7", ["background", { color: "#34d399", alpha: 0.15 }], AA],
  ["compare removed text / rose wash on background", "#fda4af", ["background", { color: "#fb7185", alpha: 0.15 }], AA],
  ["compare parchment / amber wash on background", "foreground", ["background", { color: "#fcd34d", alpha: 0.15 }], AA],
];

/** Glows and compare text for the parchment surfaces. */
const LIGHT_PAIRS = [
  ["foreground / background + gold glow", "foreground", ["background", { color: "#7a4e10", alpha: 0.16 }], AA],
  ["foreground / background + navy glow", "foreground", ["background", { color: "#10141f", alpha: 0.06 }], AA],
  ["compare added #065f46 / background", "#065f46", "background", AA],
  ["compare added #065f46 / card", "#065f46", "card", AA],
  ["compare removed #9f1239 / background", "#9f1239", "background", AA],
  ["compare removed #9f1239 / card", "#9f1239", "card", AA],
  ["compare added text / emerald wash on background", "#065f46", ["background", { color: "#34d399", alpha: 0.15 }], AA],
  ["compare removed text / rose wash on background", "#9f1239", ["background", { color: "#fb7185", alpha: 0.15 }], AA],
  ["compare foreground / amber wash on background", "foreground", ["background", { color: "#fcd34d", alpha: 0.15 }], AA],
];

function pairsFor(tokens) {
  const dark = String(tokens.background || "").toLowerCase() === "#10141f";
  return [...PAIRS, ...(dark ? DARK_PAIRS : LIGHT_PAIRS)];
}

/**
 * @param {Record<string, string>} [tokens]
 * @returns {{ label: string, ratio: number, min: number, pass: boolean }[]}
 */
export function checkContrast(tokens = readRootTokens()) {
  return pairsFor(tokens).map(([label, fg, bg, min]) => {
    if (typeof label !== "string" || typeof min !== "number") throw new Error("Bad pair");
    const surface = resolve(bg, tokens);
    const ratio = contrast(resolve(fg, tokens, surface), surface);
    return { label, ratio: Math.round(ratio * 100) / 100, min, pass: ratio >= min };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let failed = 0;
  let total = 0;
  for (const [name, tokens] of [
    ["Light", readRootTokens()],
    ["Dark", readDarkTokens()],
  ]) {
    const rows = checkContrast(tokens);
    console.log(`\n### ${name}\n\n| Pair | Ratio | Needs | Result |\n|---|---|---|---|`);
    for (const r of rows) {
      console.log(`| ${r.label} | ${r.ratio.toFixed(2)}:1 | ${r.min}:1 | ${r.pass ? "pass" : "FAIL"} |`);
    }
    const bad = rows.filter((r) => !r.pass).length;
    failed += bad;
    total += rows.length;
    console.log(`\n${rows.length - bad}/${rows.length} ${name.toLowerCase()} pairs pass.`);
  }
  process.exitCode = failed ? 1 : 0;
  console.log(`\n${total - failed}/${total} pairs pass.`);
}
