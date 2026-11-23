import { describe, expect, it } from "vitest";
import {
  BETA_DISCLAIMER,
  BETA_RELEASE_LABEL,
  PRODUCTION_RELEASE_LABEL,
  isBeta,
  releaseDisclaimer,
  releaseLabel,
  showCommit,
} from "@/lib/release-label";

const DISCLAIMER = "Spellbranch is currently in beta testing. Features may change and data may be reset.";

describe("release label", () => {
  it("shows v1.0 and hides the disclaimer on production", () => {
    const env = { VERCEL_ENV: "production" };
    expect(releaseLabel(env)).toBe("v1.0");
    expect(releaseLabel(env)).toBe(PRODUCTION_RELEASE_LABEL);
    expect(isBeta(env)).toBe(false);
    expect(releaseDisclaimer(env)).toBeNull();
    expect(showCommit(env)).toBe(false);
  });

  it("keeps Beta and the disclaimer on preview", () => {
    const env = { VERCEL_ENV: "preview" };
    expect(releaseLabel(env)).toBe("Beta");
    expect(releaseLabel(env)).toBe(BETA_RELEASE_LABEL);
    expect(isBeta(env)).toBe(true);
    expect(releaseDisclaimer(env)).toBe(DISCLAIMER);
    expect(releaseDisclaimer(env)).toBe(BETA_DISCLAIMER);
    expect(showCommit(env)).toBe(true);
  });

  it("keeps Beta and the disclaimer on development", () => {
    const env = { VERCEL_ENV: "development" };
    expect(releaseLabel(env)).toBe("Beta");
    expect(isBeta(env)).toBe(true);
    expect(releaseDisclaimer(env)).toBe(DISCLAIMER);
    expect(showCommit(env)).toBe(true);
  });

  it("keeps Beta and the disclaimer when the environment is unset", () => {
    const env = {};
    expect(releaseLabel(env)).toBe("Beta");
    expect(isBeta(env)).toBe(true);
    expect(releaseDisclaimer(env)).toBe(DISCLAIMER);
    expect(showCommit(env)).toBe(true);
  });

  it("treats a blank VERCEL_ENV as unset", () => {
    expect(releaseLabel({ VERCEL_ENV: "  " })).toBe("Beta");
    expect(releaseDisclaimer({ VERCEL_ENV: "" })).toBe(DISCLAIMER);
    expect(showCommit({ VERCEL_ENV: "  " })).toBe(true);
  });

  it("uses NEXT_PUBLIC_VERCEL_ENV only when VERCEL_ENV is unset", () => {
    expect(releaseLabel({ NEXT_PUBLIC_VERCEL_ENV: "production" })).toBe("v1.0");
    expect(releaseDisclaimer({ NEXT_PUBLIC_VERCEL_ENV: "production" })).toBeNull();
    expect(showCommit({ NEXT_PUBLIC_VERCEL_ENV: "production" })).toBe(false);
    expect(releaseLabel({ NEXT_PUBLIC_VERCEL_ENV: "preview" })).toBe("Beta");
    expect(releaseDisclaimer({ NEXT_PUBLIC_VERCEL_ENV: "development" })).toBe(DISCLAIMER);
    expect(showCommit({ NEXT_PUBLIC_VERCEL_ENV: "preview" })).toBe(true);
    expect(releaseLabel({ VERCEL_ENV: "preview", NEXT_PUBLIC_VERCEL_ENV: "production" })).toBe("Beta");
    expect(releaseDisclaimer({ VERCEL_ENV: "preview", NEXT_PUBLIC_VERCEL_ENV: "production" })).toBe(DISCLAIMER);
    expect(showCommit({ VERCEL_ENV: "preview", NEXT_PUBLIC_VERCEL_ENV: "production" })).toBe(true);
    expect(releaseLabel({ VERCEL_ENV: "production", NEXT_PUBLIC_VERCEL_ENV: "preview" })).toBe("v1.0");
    expect(releaseDisclaimer({ VERCEL_ENV: "production", NEXT_PUBLIC_VERCEL_ENV: "preview" })).toBeNull();
    expect(showCommit({ VERCEL_ENV: "production", NEXT_PUBLIC_VERCEL_ENV: "preview" })).toBe(false);
  });

  it("lets the optional public label override replace only the short label", () => {
    const production = {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SPELLBRANCH_RELEASE_LABEL: "v1.1",
    };
    expect(releaseLabel(production)).toBe("v1.1");
    expect(releaseDisclaimer(production)).toBeNull();
    expect(showCommit(production)).toBe(false);

    const preview = {
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SPELLBRANCH_RELEASE_LABEL: "  rc  ",
    };
    expect(releaseLabel(preview)).toBe("rc");
    expect(releaseDisclaimer(preview)).toBe(DISCLAIMER);
    expect(showCommit(preview)).toBe(true);

    expect(releaseLabel({ VERCEL_ENV: "production", NEXT_PUBLIC_SPELLBRANCH_RELEASE_LABEL: "  " })).toBe("v1.0");
  });
});
