import "server-only";

/**
 * User-facing rate-limit text. Same text for every policy and bucket, so it
 * reveals nothing (Cipher F9). Plain constants with no imports, so the data
 * layer can use them too (find_profile's database backstop, PT429).
 */
export const RATE_LIMITED_MESSAGE = "Too many attempts. Please try again later.";
export const RATE_LIMIT_UNAVAILABLE_MESSAGE = "Something went wrong. Please try again shortly.";
