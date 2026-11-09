import { redirect } from "next/navigation";

/**
 * The workspace root has one destination: the paper study trainer.
 * `next.config.js` redirects `/` before routing, so this page is only a
 * fallback — it stays so links to `/` still resolve to a real page.
 */
export default function WorkspaceRootPage() {
  redirect("/research-plan");
}
