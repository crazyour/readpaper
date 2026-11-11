"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * PDF preview powered by the browser's built-in viewer (PDF.js in Chrome /
 * Firefox, Preview in Safari). Loads the original file from /files/attachments
 * via an <iframe> — zero extra bundle weight.
 *
 * The "load" event sometimes fires twice in WebKit because of the inline
 * UA toolbar; we only flip the loading flag on the first one.
 */
export default function PdfPreview({
  url,
  filename,
}: {
  url: string;
  filename: string;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setStatus("loading");
  }, [url]);

  useEffect(() => {
    if (status !== "loading") return;
    const timeout = window.setTimeout(() => setStatus("error"), 12_000);
    return () => window.clearTimeout(timeout);
  }, [attempt, status, url]);

  const retry = () => {
    setStatus("loading");
    setAttempt((value) => value + 1);
  };

  return (
    <div className="relative h-full w-full bg-[var(--muted)]/30">
      {status === "loading" ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
            <Loader2
              aria-hidden
              size={14}
              className="animate-spin motion-reduce:animate-none"
            />
            <span>{t("Loading preview…")}</span>
          </div>
        </div>
      ) : null}
      {status === "error" ? (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--background)]/95 p-6 text-center"
          role="alert"
        >
          <div className="max-w-sm">
            <AlertCircle
              aria-hidden
              size={22}
              className="mx-auto text-[var(--muted-foreground)]"
            />
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {t("The preview could not be loaded.")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
              {t("Try again, or open the original file in a new tab.")}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={retry}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <RefreshCw aria-hidden size={13} />
                {t("Try again")}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <ExternalLink aria-hidden size={13} />
                {t("Open the original file")}
              </a>
            </div>
          </div>
        </div>
      ) : null}
      <iframe
        key={`${url}-${attempt}`}
        title={filename}
        src={url}
        className="h-full w-full border-0 bg-[var(--background)]"
        onLoad={() => setStatus("ready")}
        onError={() => setStatus("error")}
      />
    </div>
  );
}
