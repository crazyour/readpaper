"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import MotionProvider from "@/components/common/MotionProvider";
import ToastViewport from "@/components/common/ToastViewport";
import SettingsReturnTracker from "@/components/settings/SettingsReturnTracker";
import { WorkspaceNavigation } from "@/components/workspaces/WorkspaceNavigation";
import { AppShellProvider } from "@/context/AppShellContext";
import {
  hasStoredLanguage,
  readStoredLanguage,
} from "@/context/app-shell-storage";
import { I18nClientBridge } from "@/i18n/I18nClientBridge";
import { I18nProvider } from "@/i18n/I18nProvider";
import { normalizeLanguage, type AppLanguage } from "@/i18n/languages";

function PaperProviders({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore<AppLanguage>(
    (onStoreChange) => {
      window.addEventListener("storage", onStoreChange);
      return () => window.removeEventListener("storage", onStoreChange);
    },
    () =>
      hasStoredLanguage()
        ? readStoredLanguage()
        : normalizeLanguage(navigator.language),
    () => "en",
  );

  return <I18nProvider language={language}>{children}</I18nProvider>;
}

/**
 * Keep the paper-only page independent from the full workspace bootstrap.
 *
 * The normal shell probes auth, modules, settings and task-board state. None of
 * those are needed to upload a paper and answer its questions, and on a
 * frontend-only Vercel deployment they used to replace this page with a bare
 * "Retry" button before the paper trainer could render.
 */
export default function RootProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/research-plan") {
    return <PaperProviders>{children}</PaperProviders>;
  }

  return (
    <AppShellProvider>
      <SettingsReturnTracker />
      <WorkspaceNavigation />
      <MotionProvider>
        <I18nClientBridge>{children}</I18nClientBridge>
      </MotionProvider>
      <ToastViewport />
    </AppShellProvider>
  );
}
