"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { normalizeLanguage, type AppLanguage } from "@/i18n/languages";

const LANGUAGE_KEY = "deeptutor-language";

function readLanguage(): AppLanguage {
  try {
    return normalizeLanguage(
      localStorage.getItem(LANGUAGE_KEY) || navigator.language,
    );
  } catch {
    return normalizeLanguage(navigator.language);
  }
}

/** Minimal provider tree for the paper-only Vercel application. */
export default function RootProviders({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore<AppLanguage>(
    (onStoreChange) => {
      window.addEventListener("storage", onStoreChange);
      return () => window.removeEventListener("storage", onStoreChange);
    },
    readLanguage,
    () => "en",
  );

  return <I18nProvider language={language}>{children}</I18nProvider>;
}
