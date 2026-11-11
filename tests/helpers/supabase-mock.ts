import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny stand-in for the supabase-js query builder. Every request is
 * recorded as a Call when awaited, and answered by `respond(call)`.
 * Only the builder methods the data layer uses are implemented, so a test
 * fails loudly if the adapter starts using something else.
 */

export type Op = "select" | "insert" | "update" | "delete" | "rpc";
export type Filter = [method: string, ...args: unknown[]];

export interface Call {
  table?: string;
  fn?: string;
  op: Op;
  columns?: string;
  returning?: string;
  payload?: unknown;
  args?: unknown;
  filters: Filter[];
  single?: "single" | "maybeSingle";
  order?: unknown[];
}

export type Reply = { data: unknown; error: { code?: string; message?: string; hint?: string } | null };
export type Responder = (call: Call) => Reply | undefined;

export const ok = (data: unknown): Reply => ({ data, error: null });
export const pgError = (code: string, message = "db error"): Reply => ({
  data: null,
  error: { code, message },
});

/** Value of the first `.eq(column, value)` filter, if any. */
export function eqValue(call: Call, column: string): unknown {
  return call.filters.find((f) => f[0] === "eq" && f[1] === column)?.[2];
}

/**
 * getDeck and getCompareData always ask copy_source_link(). Tests that don't
 * care about copies get "no source" instead of an unexpected-call failure.
 * A responder that returns its own reply for that RPC still wins.
 */
export function answeringCopyLink(respond: Responder): Responder {
  return (call) => {
    const reply = respond(call);
    if (reply) return reply;
    if (call.fn === "copy_source_link" || call.fn === "copy_links_for_deck") return ok([]);
    return undefined;
  };
}

export function createMockClient(respond: Responder) {
  const calls: Call[] = [];

  const answer = (call: Call): Promise<Reply> => {
    calls.push(call);
    const reply = respond(call);
    if (!reply) {
      throw new Error(`unexpected supabase call: ${JSON.stringify(call)}`);
    }
    return Promise.resolve(reply);
  };

  function from(table: string) {
    const call: Call = { table, op: "select", filters: [] };
    const builder = {
      select(columns = "*") {
        if (call.op === "select") call.columns = columns;
        else call.returning = columns;
        return builder;
      },
      insert(payload: unknown) {
        call.op = "insert";
        call.payload = payload;
        return builder;
      },
      update(payload: unknown) {
        call.op = "update";
        call.payload = payload;
        return builder;
      },
      delete() {
        call.op = "delete";
        return builder;
      },
      eq: (...a: unknown[]) => (call.filters.push(["eq", ...a]), builder),
      filter: (...a: unknown[]) => (call.filters.push(["filter", ...a]), builder),
      neq: (...a: unknown[]) => (call.filters.push(["neq", ...a]), builder),
      in: (...a: unknown[]) => (call.filters.push(["in", ...a]), builder),
      is: (...a: unknown[]) => (call.filters.push(["is", ...a]), builder),
      not: (...a: unknown[]) => (call.filters.push(["not", ...a]), builder),
      order: (...a: unknown[]) => ((call.order = a), builder),
      single: () => ((call.single = "single"), builder),
      maybeSingle: () => ((call.single = "maybeSingle"), builder),
      then<T>(resolve: (r: Reply) => T, reject?: (e: unknown) => T) {
        return answer(call).then(resolve, reject);
      },
    };
    return builder;
  }

  const client = {
    from,
    rpc(fn: string, args: unknown) {
      return answer({ fn, op: "rpc", args, filters: [] });
    },
    auth: new Proxy(
      {},
      {
        get() {
          throw new Error("the data layer must not use supabase.auth");
        },
      },
    ),
  };

  return {
    client: client as unknown as SupabaseClient,
    calls,
    factory: async () => client as unknown as SupabaseClient,
  };
}
