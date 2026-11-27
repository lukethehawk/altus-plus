import { ipcRenderer } from "electron";

/**
 * What a tab's preload does whatever service the tab shows: zoom keys, links
 * opened in the browser and unread counts. Main checks every message against
 * the service of the tab's session.
 */

/**
 * Ctrl+= or Ctrl++, Ctrl+- and Ctrl+0 zoom the tab in, out and back (main
 * applies it). True when the key was one of them.
 */
export function sendZoomKey(event: KeyboardEvent): boolean {
  if (!event.ctrlKey) return false;
  switch (event.key) {
    case "=":
    case "+":
      ipcRenderer.send("zoom", "in");
      return true;
    case "-":
      ipcRenderer.send("zoom", "out");
      return true;
    case "0":
      ipcRenderer.send("zoom", "reset");
      return true;
    default:
      return false;
  }
}

type LinkOptions = {
  /**
   * Leave the links whose click the page handled itself (preventDefault), as
   * Telegram does when it asks before opening a masked link.
   */
  skipHandled?: boolean;
  /** Only right after the user's click or key, not on a page script's own click. */
  needsUserActivation?: boolean;
};

/**
 * Opens the page's target="_blank" links in the default browser (through
 * main, which checks them: "open-link"), except the ones `keepInPage` leaves
 * to the page itself. Call it once the page has loaded.
 */
export function openBlankLinksInBrowser(keepInPage: (url: URL) => boolean, options: LinkOptions = {}): void {
  document.body.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    if (options.skipHandled && event.defaultPrevented) return;
    if (options.needsUserActivation && !navigator.userActivation.isActive) return;
    if (
      event.target.tagName === "A" &&
      event.target.getAttribute("target") === "_blank"
    ) {
      if (keepInPage(new URL(event.target.href))) return;
      ipcRenderer.send("open-link", event.target.href);
    }
  });
}

let sentMessageCount: number | undefined;

/**
 * Sends the tab's unread count when it changes (or always, with `first`).
 * Main credits it to this page's tab from its session, so it carries no tab
 * ID.
 */
export function sendUnreadCount(messageCount: number, first = false): void {
  if (!first && messageCount === sentMessageCount) return;
  sentMessageCount = messageCount;
  ipcRenderer.send("message-count", { messageCount });
}
