"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Lightweight preview that delegates PDF rendering to the browser. */
export default function PdfPreview({
  url,
  filename,
}: {
  url: string;
  filename: string;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setStatus("loading"), [url]);
  useEffect(() => {
    if (status !== "loading") return;
    const timeout = window.setTimeout(() => setStatus("error"), 12_000);
    return () => window.clearTimeout(timeout);
  }, [attempt, status, url]);

  return (
    <div className="relative h-full w-full bg-muted/30">
      {status === "loading" ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 aria-hidden size={14} className="animate-spin motion-reduce:animate-none" />
            <span>{t("Loading preview…")}</span>
          </div>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/95 p-6 text-center" role="alert">
          <div className="max-w-sm">
            <AlertCircle aria-hidden size={22} className="mx-auto text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{t("The preview could not be loaded.")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("Try again, or open the original file in a new tab.")}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStatus("loading");
                  setAttempt((value) => value + 1);
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RefreshCw aria-hidden size={13} />
                {t("Try again")}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
        className="h-full w-full border-0 bg-background"
        onLoad={() => setStatus("ready")}
        onError={() => setStatus("error")}
      />
    </div>
  );
}
