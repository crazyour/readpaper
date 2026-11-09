import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = { pathname: "/chat" };

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("@/hooks/useDevice", () => ({
  useDevice: () => ({ isMobile: false }),
}));

import AppShell from "@/components/layout/AppShell";

beforeEach(() => {
  navigation.pathname = "/chat";
});

function renderShell() {
  return render(
    <AppShell sidebar={<nav data-testid="sidebar" />}>
      <div data-testid="content" />
    </AppShell>,
  );
}

describe("AppShell chrome", () => {
  it("keeps the sidebar on ordinary pages", () => {
    renderShell();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it("drops the sidebar on the paper study trainer", () => {
    navigation.pathname = "/research-plan";
    renderShell();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    // The page itself is still mounted, and takes the full width.
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("does not render a menu button when there is nothing to open", () => {
    navigation.pathname = "/research-plan";
    renderShell();
    expect(screen.queryByLabelText("Open navigation")).not.toBeInTheDocument();
  });
});
