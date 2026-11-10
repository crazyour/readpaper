/** UI locales that have a selectable bundle. The bundles may fall back to English per key. */
export const APP_LANGUAGES = [
  { code: "en", labelKey: "language.english" },
  { code: "zh", labelKey: "language.chinese" },
] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number]["code"];

const SUPPORTED_CODES: ReadonlySet<string> = new Set(
  APP_LANGUAGES.map(({ code }) => code),
);

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && SUPPORTED_CODES.has(value);
}

export function normalizeLanguage(value: unknown): AppLanguage {
  if (typeof value !== "string") return "en";
  // replaceAll is unavailable in older Safari releases still used by some
  // iPads. A global regular expression has identical behaviour here.
  const code = value.trim().toLowerCase().replace(/_/g, "-");
  const base = code.split("-", 1)[0];
  if (base === "zh" || base === "cn" || code === "chinese") return "zh";
  return "en";
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
