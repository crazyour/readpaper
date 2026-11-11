import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

import zhApp from "@/locales/zh/app.json";
import { type AppLanguage } from "./languages";

export { APP_LANGUAGES, isAppLanguage, normalizeLanguage } from "./languages";
export type { AppLanguage } from "./languages";

let _initialized = false;

export function initI18n(language?: unknown) {
  if (_initialized) return i18n;
  void language;

  const resources: Resource = {
    zh: { app: zhApp },
  };

  i18n.use(initReactI18next).init({
    resources,
    lng: "zh",
    fallbackLng: "zh",
    supportedLngs: ["zh"],
    // Use a single default namespace to keep lookups simple.
    // We intentionally keep keySeparator disabled so keys like "Generating..." remain valid.
    // nsSeparator too: keys like "Query:" or "http://localhost:8080" would otherwise split as ns:key.
    defaultNS: "app",
    ns: ["app"],
    keySeparator: false,
    nsSeparator: false,
    interpolation: {
      escapeValue: false,
    },
    returnEmptyString: false,
    returnNull: false,
  });

  _initialized = true;
  return i18n;
}

export async function ensureLanguage(language: AppLanguage) {
  void language;
}
