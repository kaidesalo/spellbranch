import { describe, expect, it } from "vitest";
import {
  AVATAR_PRESETS,
  avatarPresetByKey,
  isAvatarPresetKey,
  resolveAvatar,
} from "@/lib/avatar-presets";

describe("avatar presets", () => {
  it("lists the five crops and only those keys", () => {
    expect(AVATAR_PRESETS.map((preset) => preset.key)).toEqual([
      "ghalta",
      "lathliss",
      "gisa",
      "sai",
      "giada",
    ]);
    expect(AVATAR_PRESETS.map((preset) => preset.label)).toEqual([
      "Ghalta, Primal Hunger",
      "Lathliss, Dragon Queen",
      "Ghoulcaller Gisa",
      "Sai, Master Thopterist",
      "Giada, Font of Hope",
    ]);
    for (const preset of AVATAR_PRESETS) {
      expect(preset.src256).toBe(`/avatars/${preset.key}-256.webp`);
      expect(preset.src512).toBe(`/avatars/${preset.key}-512.webp`);
      expect(preset.artist.trim().length).toBeGreaterThan(0);
      expect(isAvatarPresetKey(preset.key)).toBe(true);
    }
    expect(AVATAR_PRESETS.map((preset) => preset.artist)).toEqual([
      "Raph Lomotan",
      "Zoltan Boros",
      "Miguel Mercado",
      "Bryan Sola",
      "Johannes Voss",
    ]);
    expect(isAvatarPresetKey("atraxa")).toBe(false);
    expect(isAvatarPresetKey("https://cdn.example/a.png")).toBe(false);
    expect(avatarPresetByKey("nope")).toBeNull();
  });

  it("uses a known preset ahead of avatar_url, and an unknown key falls back", () => {
    const url = "https://cdn.example/ada.png";
    expect(resolveAvatar({ avatarPreset: "giada", avatarUrl: url }, 256)).toEqual({
      src: "/avatars/giada-256.webp",
      alt: "Giada, Font of Hope",
    });
    expect(resolveAvatar({ avatarPreset: "giada", avatarUrl: url }, 512)).toEqual({
      src: "/avatars/giada-512.webp",
      alt: "Giada, Font of Hope (art by Johannes Voss)",
      title: "Giada, Font of Hope (art by Johannes Voss)",
    });
    expect(resolveAvatar({ avatarPreset: "not-a-card", avatarUrl: url })).toEqual({ src: url, alt: "" });
    expect(resolveAvatar({ avatarPreset: null, avatarUrl: "http://cdn.example/a.png" })).toBeNull();
    expect(resolveAvatar({ avatarPreset: "", avatarUrl: null })).toBeNull();
  });
});
