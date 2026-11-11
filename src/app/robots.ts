import type { MetadataRoute } from "next";

/**
 * Public for-trade lists (/u/{username}) and the signed-in collection
 * (/my-cards) should not be indexed. Everything else stays crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: ["/u/", "/my-cards"],
    },
  };
}
