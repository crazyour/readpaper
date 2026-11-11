/** The web interface is intentionally Chinese-only. */
export const APP_LANGUAGES = [
  { code: "zh", labelKey: "language.chinese" },
] as const;

// Keep the legacy English value in the type while stored settings migrate.
// Runtime normalization below always resolves the interface to Chinese.
export type AppLanguage = "zh" | "en";

const SUPPORTED_CODES: ReadonlySet<string> = new Set(
  APP_LANGUAGES.map(({ code }) => code),
);

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && SUPPORTED_CODES.has(value);
}

export function normalizeLanguage(value: unknown): AppLanguage {
  void value;
  return "zh";
}

/** Model output can use more languages than the app UI locale supports. */
export type ResponseLanguage =
  | "en"
  | "zh"
  | "zh-tw"
  | "ja"
  | "ko"
  | "es"
  | "fr"
  | "de"
  | "ru"
  | "pt"
  | "it"
  | "ar"
  | "pl"
  | "uk"
  | "ms"
  | "vi"
  | "tr";
