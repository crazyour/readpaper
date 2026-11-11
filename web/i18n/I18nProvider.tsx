"use client";

import { useEffect } from "react";
import { initI18n, type AppLanguage } from "./init";

// Initialize i18next at module load (before any React render) so that the
// `init()` call — which fires `initialized` / `languageChanged` events that
// trigger setState on subscribed components — never happens during another
// component's render phase. Calling `initI18n` from the render body would
// produce the React warning:
//   "Cannot update a component (`X`) while rendering a different component
//   (`I18nProvider`)."
initI18n();

export function I18nProvider({
  language,
  enabled = true,
  children,
}: {
  language: AppLanguage | string;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  void language;

  useEffect(() => {
    document.documentElement.lang = "zh-CN";
  }, []);

  if (!enabled) {
    return (
      <div
        aria-busy="true"
        aria-hidden="true"
        className="min-h-dvh bg-[var(--background)]"
      />
    );
  }
  return children;
}
