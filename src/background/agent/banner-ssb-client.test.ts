// banner-ssb-client tests. The seam under test is the network boundary: an
// expired Banner session does NOT return a 4xx — Ellucian 302s to the SSO login
// page, `fetch` follows it, and the extension gets a 200 text/html body. Calling
// `.json()` on that throws a raw SyntaxError, which the worker forwards to the
// UI as a generic catalog error. The fix is a typed SessionExpiredError so the
// UI can offer the one recovery that actually works: re-establish the session.
// Implements: ADR 0029.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getTerms,
  fetchAllSectionsForTerm,
  SessionExpiredError,
} from "./banner-ssb-client";

function res(body: string, contentType: string, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response;
}

const LOGIN_HTML = "<!DOCTYPE html><html><body>Fordham Login</body></html>";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe("getJSON content-type guard", () => {
  it("throws SessionExpiredError when the login page is served instead of JSON", async () => {
    fetchMock.mockResolvedValue(res(LOGIN_HTML, "text/html;charset=UTF-8"));

    // Not a SyntaxError from JSON.parse — a typed, actionable error.
    await expect(getTerms()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("parses a real JSON response", async () => {
    fetchMock.mockResolvedValue(
      res(JSON.stringify([{ code: "202710", description: "Fall 2026" }]), "application/json")
    );

    await expect(getTerms()).resolves.toEqual([{ code: "202710", description: "Fall 2026" }]);
  });

  it("still reports a non-ok status as a plain error, not an expiry", async () => {
    fetchMock.mockResolvedValue(res("boom", "text/html", false));

    const err = await getTerms().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SessionExpiredError);
  });
});

describe("fetchAllSectionsForTerm", () => {
  it("throws SessionExpiredError when Banner returns success:false on the first page", async () => {
    // resetSession + bindTerm succeed; the search comes back with the
    // silent-desync shape Banner uses when the session lost its criteria.
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("searchResults")) {
        return res(JSON.stringify({ success: false, data: null, totalCount: 0 }), "application/json");
      }
      return res("{}", "application/json");
    });

    await expect(fetchAllSectionsForTerm("202710")).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
