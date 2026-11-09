/**
 * Paper upload bridge.
 *
 * Multipart bodies are streamed straight to FastAPI rather than through
 * `proxy.ts`, whose automatic request clone truncates large uploads. This path
 * is therefore excluded from the proxy matcher in `proxy.ts`.
 */
import { forwardBackendUpload } from "@/lib/streaming-upload-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return forwardBackendUpload(request);
}
