/**
 * Pages that own the whole window.
 *
 * The paper study trainer is a single-purpose surface: it draws its own header
 * and has nothing to navigate to, so the sidebar and the mobile top bar would
 * only sit between the student and the paper. The same list decides the top
 * page bar (see `components/sidebar/page-sections.ts`) so one entry removes
 * every piece of app chrome.
 */
const CHROMELESS_ROUTES: readonly RegExp[] = [/^\/research-plan\/?$/];

export function isChromelessRoute(pathname: string): boolean {
  return CHROMELESS_ROUTES.some((pattern) => pattern.test(pathname ?? ""));
}
