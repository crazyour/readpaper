# Vercel paper trainer deployment

The Vercel build is intentionally a focused paper-questioning application. It
does not deploy the FastAPI backend, database, account system, or the rest of
the DeepTutor workspace.

## Runtime design

The browser extracts text from PDF, DOCX, TXT, and Markdown files and keeps the
paper plus training progress in that browser's local storage. Same-origin Next
route handlers send bounded paper text to MiniMax and return the outline,
questions, feedback, hints, and summaries.

This means Vercel needs no Railway service and no backend URL. The MiniMax key
is read only by the server route handlers and is never exposed through a
`NEXT_PUBLIC_` variable.

## Deploy

Import the GitHub repository into Vercel and use these project settings:

- Framework Preset: `Next.js`
- Root Directory: `web`
- Node.js Version: `22.x`
- Install Command: `npm ci --legacy-peer-deps`
- Build Command: `npm run build`

Add exactly one environment variable for Production, Preview, and Development:

```text
MINIMAX_API_KEY=<your MiniMax API key>
```

Do not add `NEXT_PUBLIC_` to the name. Do not set
`DEEPTUTOR_API_BASE_URL`, `NEXT_PUBLIC_API_BASE`, authentication variables, or
`DEEPTUTOR_PAPER_ONLY`. Vercel automatically enables the paper-only surface.

After saving the variable, redeploy. Open `/research-plan`; `/` redirects to
that page and unrelated workspace routes return 404 by design.

## Behavior and limits

- Original files are parsed in the browser instead of being stored on Vercel.
- Extracted text is capped at 80,000 characters per paper.
- PDF previews remain available in the tab where the file was selected. After
  a reload, progress is restored but the original file must be selected again
  to restore its preview.
- Image-only or scanned PDFs require OCR before upload.
- Browser data is local to that device and can be lost when site data is
  cleared. This focused deployment has no cross-device synchronization.
- Anyone who can use a public deployment can spend the configured MiniMax API
  quota. Protect the Vercel project or add product authentication before
  sharing it broadly.

MiniMax keys are regional. The server discovers whether a key belongs to the
global (`api.minimax.io`) or China (`api.minimaxi.com`) platform and selects an
available current text model automatically.

## Troubleshooting

If the page shows `Retry`, inspect the failed request in the browser Network
panel:

- `503` mentioning `MINIMAX_API_KEY`: add the variable and redeploy.
- `401`: copy the complete key again from the MiniMax platform that issued it.
- `429`: the MiniMax account has reached a rate or quota limit.
- Paper extraction error: confirm the file contains selectable text or run OCR
  first.

Environment changes do not alter an already completed deployment. Use Vercel's
Redeploy action after every variable change.
