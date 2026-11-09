import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { extractPaperText } from "@/features/paper-trainer/extract";

describe("local paper text extraction", () => {
  it("reads plain text without sending the file anywhere", async () => {
    const text = "Research question and method. ".repeat(8);
    await expect(
      extractPaperText(new File([text], "paper.txt")),
    ).resolves.toBe(text.trim());
  });

  it("reads paragraph text from DOCX in the browser", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>${"First paragraph. ".repeat(6)}</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    const result = await extractPaperText(new File([bytes], "paper.docx"));
    expect(result).toContain("First paragraph.");
    expect(result).toContain("Second paragraph.");
  });

  it("rejects image-only or empty documents with an OCR hint", async () => {
    await expect(
      extractPaperText(new File(["short"], "paper.md")),
    ).rejects.toThrow(/OCR/);
  });
});
