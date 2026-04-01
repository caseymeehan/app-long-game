import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch for ip-api.com
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { resolveCountry } from "./country.server";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000", { headers });
}

describe("resolveCountry", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ─── Priority Ordering ───

  it("uses CF-IPCountry header first", async () => {
    const result = await resolveCountry(makeRequest({ "CF-IPCountry": "BR" }));
    expect(result).toBe("BR");
  });

  it("falls back to ip-api.com when no CF header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ countryCode: "NG" }),
    });
    const result = await resolveCountry(
      makeRequest({ "X-Forwarded-For": "1.2.3.4" }),
    );
    expect(result).toBe("NG");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://ip-api.com/json/1.2.3.4?fields=countryCode",
    );
  });

  it("returns null when all methods fail", async () => {
    const result = await resolveCountry(makeRequest());
    expect(result).toBeNull();
  });

  // ─── CF-IPCountry Behavior ───

  it("normalizes CF-IPCountry to uppercase", async () => {
    const result = await resolveCountry(makeRequest({ "CF-IPCountry": "de" }));
    expect(result).toBe("DE");
  });

  it("ignores CF-IPCountry when value is XX", async () => {
    const result = await resolveCountry(makeRequest({ "CF-IPCountry": "XX" }));
    expect(result).toBeNull();
  });

  // ─── ip-api.com Behavior ───

  it("uses first IP from X-Forwarded-For", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ countryCode: "JP" }),
    });
    await resolveCountry(
      makeRequest({ "X-Forwarded-For": "1.2.3.4, 5.6.7.8" }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "http://ip-api.com/json/1.2.3.4?fields=countryCode",
    );
  });

  it("returns null when ip-api.com returns non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const result = await resolveCountry(
      makeRequest({ "X-Forwarded-For": "1.2.3.4" }),
    );
    expect(result).toBeNull();
  });

  it("returns null when ip-api.com throws (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const result = await resolveCountry(
      makeRequest({ "X-Forwarded-For": "1.2.3.4" }),
    );
    expect(result).toBeNull();
  });

  it("returns null when ip-api.com returns no countryCode", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "fail" }),
    });
    const result = await resolveCountry(
      makeRequest({ "X-Forwarded-For": "1.2.3.4" }),
    );
    expect(result).toBeNull();
  });

  it("skips ip-api.com when no X-Forwarded-For header", async () => {
    const result = await resolveCountry(makeRequest());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
