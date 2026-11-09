/**
 * The backend's public origin, when the browser should talk to it directly.
 *
 * Normally every request stays same-origin and `proxy.ts` forwards it to
 * FastAPI, which keeps cookies and `/files/...` URLs working. Two deployments
 * need a different route:
 *
 * - Vercel caps a Serverless Function's request body at 4.5 MB, and a paper is
 *   routinely larger than that. A multipart upload therefore has to reach the
 *   API host without passing through the frontend.
 * - A self-hosted frontend on a different origin than its API has the same
 *   problem for the same reason.
 *
 * `NEXT_PUBLIC_API_BASE` is the configured API address (also read by
 * `next.config.js`). It is only used here when it is an absolute URL that
 * differs from the page's own origin — otherwise the same-origin proxy is the
 * better path and this returns `null`.
 */
const LOOPBACK_HOSTS = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

export function publicBackendBase(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = (env.NEXT_PUBLIC_API_BASE ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  if (typeof window === "undefined") return null;

  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    return null;
  }
  if (base.origin === window.location.origin) return null;
  // A loopback API is only reachable from the machine running the browser, so
  // it is never a better target than the same-origin proxy: the local launcher
  // builds bake `http://localhost:8001` in, and a phone on the LAN opening
  // `http://192.168.x.x:3782` must not be sent to its own localhost.
  if (LOOPBACK_HOSTS.test(base.hostname)) return null;
  return base.origin;
}
