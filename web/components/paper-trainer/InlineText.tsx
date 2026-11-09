"use client";

import type { ReactNode } from "react";

/**
 * Inline emphasis from model-written prose.
 *
 * The tutor writes `**like this**` to stress a word, and quotes an identifier
 * in backticks. Rendering that as literal asterisks made every feedback card
 * read like a broken document, so the two markers are turned into elements —
 * nothing else is interpreted, and no HTML is ever parsed.
 */
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

export default function InlineText({ text }: { text: string }): ReactNode {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((part, index) => {
        if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={index} className="font-semibold text-card-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={index}
              className="rounded bg-muted px-1 py-[1px] font-mono text-[0.92em] text-card-foreground"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}
