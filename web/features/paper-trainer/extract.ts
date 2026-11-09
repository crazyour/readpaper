/** Browser-side paper extraction for the Vercel-only trainer. */

import JSZip from "jszip";

import {
  loadPdfjs,
  pdfjsCMapUrl,
  pdfjsWasmUrl,
} from "@/lib/pdfjs-loader";

export const MAX_PAPER_TEXT_CHARS = 80_000;

function normalizePaperText(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_PAPER_TEXT_CHARS);
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    wasmUrl: pdfjsWasmUrl(),
    cMapUrl: pdfjsCMapUrl(),
    cMapPacked: true,
  });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) =>
          "str" in item && typeof item.str === "string" ? [item.str] : [],
        )
        .join(" ")
        .trim();
      if (!text) continue;
      const block = `[Page ${pageNumber}]\n${text}`;
      pages.push(block);
      length += block.length;
      if (length >= MAX_PAPER_TEXT_CHARS) break;
    }
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}

async function extractDocx(file: File): Promise<string> {
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const document = archive.file("word/document.xml");
  if (!document) return "";
  const xml = new DOMParser().parseFromString(
    await document.async("text"),
    "application/xml",
  );
  if (xml.querySelector("parsererror")) return "";
  const paragraphs = Array.from(xml.getElementsByTagNameNS("*", "p"));
  return paragraphs
    .map((paragraph) =>
      Array.from(paragraph.getElementsByTagNameNS("*", "t"))
        .map((node) => node.textContent ?? "")
        .join(""),
    )
    .filter(Boolean)
    .join("\n");
}

/** Extract enough text for grounded MiniMax calls without uploading the file. */
export async function extractPaperText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  let raw = "";
  if (name.endsWith(".pdf")) raw = await extractPdf(file);
  else if (name.endsWith(".docx")) raw = await extractDocx(file);
  else if (name.endsWith(".md") || name.endsWith(".txt")) raw = await file.text();
  const text = normalizePaperText(raw);
  if (text.length < 80) {
    throw new Error(
      "The paper contains too little extractable text. Scanned PDFs need OCR before upload.",
    );
  }
  return text;
}
