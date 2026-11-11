"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/I18nProvider";

/** Minimal provider tree for the paper-only Vercel application. */
export default function RootProviders({ children }: { children: ReactNode }) {
  return <I18nProvider language="zh">{children}</I18nProvider>;
}
