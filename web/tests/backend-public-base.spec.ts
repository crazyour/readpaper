import { describe, expect, it } from "vitest";

import { publicBackendBase } from "@/lib/backend-public-base";

describe("publicBackendBase", () => {
  it("is null without a configured base", () => {
    expect(publicBackendBase({})).toBeNull();
    expect(publicBackendBase({ NEXT_PUBLIC_API_BASE: "" })).toBeNull();
    expect(publicBackendBase({ NEXT_PUBLIC_API_BASE: "   " })).toBeNull();
  });

  it("ignores a relative base — those go through the same-origin proxy", () => {
    expect(publicBackendBase({ NEXT_PUBLIC_API_BASE: "/api" })).toBeNull();
  });

  it("ignores a loopback API — same-origin proxy is always the right target", () => {
    // jsdom serves the test page from http://localhost/.
    expect(
      publicBackendBase({ NEXT_PUBLIC_API_BASE: "http://localhost" }),
    ).toBeNull();
    // The local launcher bakes this in; a phone on the LAN must not be sent
    // to its own localhost.
    expect(
      publicBackendBase({ NEXT_PUBLIC_API_BASE: "http://localhost:8001" }),
    ).toBeNull();
    expect(
      publicBackendBase({ NEXT_PUBLIC_API_BASE: "http://127.0.0.1:8001" }),
    ).toBeNull();
  });

  it("returns the origin of a different host, without any trailing path", () => {
    expect(
      publicBackendBase({
        NEXT_PUBLIC_API_BASE: "https://deeptutor-api.fly.dev/",
      }),
    ).toBe("https://deeptutor-api.fly.dev");
    expect(
      publicBackendBase({
        NEXT_PUBLIC_API_BASE: "https://deeptutor-api.fly.dev/v1",
      }),
    ).toBe("https://deeptutor-api.fly.dev");
  });

  it("rejects anything that is not an http(s) URL", () => {
    expect(
      publicBackendBase({ NEXT_PUBLIC_API_BASE: "wss://example.com" }),
    ).toBeNull();
    expect(publicBackendBase({ NEXT_PUBLIC_API_BASE: "not a url" })).toBeNull();
  });
});
