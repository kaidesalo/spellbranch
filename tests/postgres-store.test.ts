import { describe, expect, it, vi } from "vitest";
import { PostgresStore, type RateLimitRpc } from "@/lib/rate-limit/postgres-store";

// PostgresStore against an injected rpc (the real secret-key client is a
// pending commit; see README "Rate limiting status").

describe("PostgresStore", () => {
  it("calls rate_limit_hit with the key, limit and window and passes the signal on", async () => {
    const rpc = vi.fn<RateLimitRpc>(async () => ({ data: [{ allowed: true, retry_after: 0 }], error: null }));
    const signal = new AbortController().signal;
    const result = await new PostgresStore(rpc).hit("abc", 10, 300, signal);
    expect(result).toEqual({ allowed: true, retryAfterSec: 0 });
    expect(rpc).toHaveBeenCalledWith({ p_key: "abc", p_limit: 10, p_window_seconds: 300 }, signal);
  });

  it("maps a blocked row", async () => {
    const rpc: RateLimitRpc = async () => ({ data: [{ allowed: false, retry_after: 42 }], error: null });
    expect(await new PostgresStore(rpc).hit("abc", 1, 60)).toEqual({ allowed: false, retryAfterSec: 42 });
  });

  it("accepts a single-object payload too", async () => {
    const rpc: RateLimitRpc = async () => ({ data: { allowed: true, retry_after: 0 }, error: null });
    expect((await new PostgresStore(rpc).hit("abc", 1, 60)).allowed).toBe(true);
  });

  it("throws on an RPC error, without the key in the message", async () => {
    const rpc: RateLimitRpc = async () => ({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(new PostgresStore(rpc).hit("secret-key-value", 1, 60)).rejects.toThrow(
      /^rate_limit_hit failed \(42501\)$/,
    );
  });

  it.each([[null], [[]], [[{ allowed: "yes", retry_after: 0 }]], [[{ allowed: true }]]])(
    "throws on an unexpected payload %j",
    async (data) => {
      const rpc: RateLimitRpc = async () => ({ data, error: null });
      await expect(new PostgresStore(rpc).hit("k", 1, 60)).rejects.toThrow(/unexpected/);
    },
  );
});
