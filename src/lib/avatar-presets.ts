import { safeAvatarUrl } from "@/lib/profile-display";

/**
 * Built-in profile pictures. The key is what we store. The files live in
 * public/avatars/ and are already square WebP crops (256 and 512).
 *
 * A known preset wins over profiles.avatar_url. An unknown or empty key is
 * ignored, then safeAvatarUrl decides whether the stored URL can be shown.
 * Anything left is the initials fallback.
 */
export const AVATAR_PRESETS = [
  {
    key: "ghalta",
    label: "Ghalta, Primal Hunger",
    src256: "/avatars/ghalta-256.webp",
    src512: "/avatars/ghalta-512.webp",
  },
  {
    key: "lathliss",
    label: "Lathliss, Dragon Queen",
    src256: "/avatars/lathliss-256.webp",
    src512: "/avatars/lathliss-512.webp",
  },
  {
    key: "gisa",
    label: "Ghoulcaller Gisa",
    src256: "/avatars/gisa-256.webp",
    src512: "/avatars/gisa-512.webp",
  },
  {
    key: "sai",
    label: "Sai, Master Thopterist",
    src256: "/avatars/sai-256.webp",
    src512: "/avatars/sai-512.webp",
  },
  {
    key: "giada",
    label: "Giada, Font of Hope",
    src256: "/avatars/giada-256.webp",
    src512: "/avatars/giada-512.webp",
  },
] as const;

export type AvatarPresetKey = (typeof AVATAR_PRESETS)[number]["key"];

const BY_KEY = new Map(AVATAR_PRESETS.map((preset) => [preset.key, preset]));

export function isAvatarPresetKey(value: unknown): value is AvatarPresetKey {
  return typeof value === "string" && BY_KEY.has(value as AvatarPresetKey);
}

export function avatarPresetByKey(value: string | null | undefined) {
  if (!value) return null;
  return BY_KEY.get(value as AvatarPresetKey) ?? null;
}

export type ResolvedAvatar = { src: string; alt: string };

/**
 * The image to show, or null for the initials fallback.
 * Preset first, then a safe https avatar_url.
 */
export function resolveAvatar(
  input: { avatarPreset?: string | null; avatarUrl?: string | null },
  size: 256 | 512 = 256,
): ResolvedAvatar | null {
  const preset = avatarPresetByKey(input.avatarPreset);
  if (preset) {
    return { src: size === 512 ? preset.src512 : preset.src256, alt: preset.label };
  }
  const url = safeAvatarUrl(input.avatarUrl);
  if (url) return { src: url, alt: "" };
  return null;
}

/** PostgREST / Postgres when profiles.avatar_preset has not been added yet. */
export function isMissingAvatarPresetColumn(
  error: { message?: string } | null | undefined,
): boolean {
  return typeof error?.message === "string" && error.message.includes("avatar_preset");
}
