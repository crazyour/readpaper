"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

import PdfPreview from "@/components/chat/preview/previewers/PdfPreview";
import { Dialog, StatusChip } from "@/shared/ui";
import type { PaperEvidence } from "@/features/paper-trainer/model";

const BASIS_LABEL: Record<string, string> = {
  stated: "Stated by the authors",
  inferred: "Inferred from the paper",
  extension: "Beyond the paper",
};

/**
 * The original paper, opened next to the passages the tutor cited.
 *
 * The viewer jumps to a page when the parser located one; when it could not,
 * the section name is all we show — the trainer never invents a page number.
 */
export default function OriginalPaperPanel({
  open,
  onClose,
  title,
  sourceUrl,
  filename,
  evidence = [],
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sourceUrl: string;
  filename: string;
  evidence?: PaperEvidence[];
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<number | null>(null);

  // Closing the viewer forgets which page was showing, so reopening starts
  // from the top of the paper rather than an unrelated citation.
  const handleClose = () => {
    setPage(null);
    onClose();
  };

  const url = sourceUrl
    ? page !== null
      ? `${sourceUrl}#page=${page}`
      : sourceUrl
    : "";
  const canPreview = /\.pdf$/i.test(filename) || /\.pdf($|[?#])/i.test(sourceUrl);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("Original paper")}
      description={title || filename}
      size="xl"
      closeLabel={t("Close")}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="h-[60vh] overflow-hidden rounded-xl border border-border/70 bg-muted/20">
          {canPreview ? (
            <PdfPreview url={url} filename={filename} />
          ) : sourceUrl ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <FileText size={20} className="text-muted-foreground" />
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("Open the original file")}
              </a>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-[12.5px] text-muted-foreground">
              {t("The original file is not available.")}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("Cited passages")}
          </p>
          {evidence.length ? (
            <ul className="mt-2 space-y-2">
              {evidence.map((item, index) => (
                <li
                  key={`${index}-${item.section}-${item.quote.slice(0, 16)}`}
                  className="rounded-lg border border-border/70 bg-card px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip tone="neutral">
                      {t(BASIS_LABEL[item.basis] ?? BASIS_LABEL.stated)}
                    </StatusChip>
                    {item.page !== null && item.page !== undefined ? (
                      <button
                        type="button"
                        onClick={() => setPage(item.page)}
                        className="cursor-pointer rounded-sm text-[11.5px] font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 motion-reduce:transition-none"
                      >
                        {t("Page {{page}}", { page: item.page })}
                      </button>
                    ) : null}
                  </div>
                  {item.section ? (
                    <p className="mt-1.5 text-[11.5px] font-medium text-card-foreground">
                      {item.section}
                    </p>
                  ) : null}
                  {item.quote ? (
                    <blockquote className="mt-1.5 border-l-2 border-primary/35 pl-2.5 font-serif text-[12px] italic leading-[1.7] text-muted-foreground">
                      {item.quote}
                    </blockquote>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] leading-[1.7] text-muted-foreground">
              {t(
                "No cited passages yet. Complete a round or request a hint to add them here.",
              )}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
