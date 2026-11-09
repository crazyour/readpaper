import { describe, expect, it } from "vitest";

import { isChromelessRoute } from "@/lib/chromeless-routes";

describe("chromeless routes", () => {
  it("gives the paper study trainer the whole window", () => {
    expect(isChromelessRoute("/research-plan")).toBe(true);
    expect(isChromelessRoute("/research-plan/")).toBe(true);
  });

  it("leaves every other page its sidebar and bar", () => {
    for (const pathname of ["/", "/chat", "/chat/session-1", "/settings", "/research-planner"]) {
      expect(isChromelessRoute(pathname)).toBe(false);
    }
  });
});
