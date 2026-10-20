import "server-only";

import { localRepository } from "@/lib/data/local";
import { createSupabaseRepository } from "@/lib/data/supabase";
import type { Repository } from "@/lib/data/types";
import { getBackend } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type { Repository } from "@/lib/data/types";
export { DataError, userMessage } from "@/lib/data/errors";

/**
 * The data backend for this request, picked by getBackend()
 * (SPELLBRANCH_BACKEND). Supabase mode uses the request-scoped server client
 * (src/lib/supabase/server.ts: the user's session cookies, publishable/anon
 * key). There is deliberately no service-role path.
 */
export function getRepository(): Repository {
  return getBackend() === "supabase" ? createSupabaseRepository(createClient) : localRepository;
}
