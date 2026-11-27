import { contextBridge, ipcRenderer } from "electron";
import { setUpAccountNotifications } from "./utils/webview/accountNotifications";
import { openBlankLinksInBrowser, sendUnreadCount, sendZoomKey } from "./utils/webview/tabPage";

// Telegram Web (K version) tabs. Telegram has its own themes, text formatting
// and Enter key, so there are none of WhatsApp's here.

// Telegram's own links (t.me and its other names) open inside the page.
const TELEGRAM_LINK_HOSTS = new Set(["t.me", "telegram.me", "telegram.dog", "web.telegram.org"]);

/** The unread count the page last reported, sent again to a new window. */
let unreadCount = 0;

type TelegramBridge = {
  setUnreadCount: (count: unknown) => void;
  openLink: (address: unknown) => void;
};

const telegramBridge: TelegramBridge = {
  setUnreadCount: (count) => {
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return;
    unreadCount = count;
    sendUnreadCount(count);
  },
  // Main opens it in the browser if it is an http(s) address.
  openLink: (address) => {
    if (typeof address !== "string" || !navigator.userActivation.isActive) return;
    ipcRenderer.send("open-link", address);
  },
};

// Serialized into the page's world: must not reference anything outside.
function installTelegramHooks(bridge: TelegramBridge) {
  // Telegram sets the app badge to its unread chats, unmuted ones only,
  // whenever they change, also while the tab is shown: that is the tab's
  // count. It no longer reaches Electron, which would put it on the taskbar
  // past the app's own badge, its setting and the accounts' mutes.
  const setAppBadge = function setAppBadge(contents?: number) {
    bridge.setUnreadCount(contents);
    return Promise.resolve();
  };
  const clearAppBadge = function clearAppBadge() {
    bridge.setUnreadCount(0);
    return Promise.resolve();
  };
  for (const [name, value] of [
    ["setAppBadge", setAppBadge],
    ["clearAppBadge", clearAppBadge],
  ] as const) {
    Object.defineProperty(Navigator.prototype, name, { value, writable: true, configurable: true, enumerable: true });
  }

  // Tabs open no windows, so window.open would do nothing: the links Telegram
  // opens this way (a bot's link button, a masked link once confirmed) go to
  // the browser, only right after the user's click or key.
  const open = function open(url?: string | URL) {
    if (url !== undefined && String(url) !== "") {
      try {
        bridge.openLink(new URL(String(url), location.href).href);
      } catch {
        // Not an address: nothing to open.
      }
    }
    return null;
  };
  Object.defineProperty(window, "open", { value: open, writable: true, configurable: true, enumerable: true });
}

// Zoom keys before the page's own shortcuts see them.
window.addEventListener("keydown", (event) => sendZoomKey(event), true);

// A listener, not window.onload, which the page could take over.
window.addEventListener("load", () => {
  // A link Telegram handled itself (it asks before opening a masked link) is
  // left to it.
  openBlankLinksInBrowser((url) => TELEGRAM_LINK_HOSTS.has(url.hostname), {
    skipHandled: true,
    needsUserActivation: true,
  });
});

ipcRenderer.on("set-id", (_event, id: unknown) => {
  if (!document.body || typeof id !== "string") return;
  // The first time: send the count the page reported so far.
  if (!document.body.dataset.tabId) sendUnreadCount(unreadCount, true);
  document.body.dataset.tabId = id;
});

// Before the page's own scripts run.
contextBridge.executeInMainWorld({
  func: installTelegramHooks,
  args: [telegramBridge],
});
// Account name, per-account mute and notification clicks: Telegram shows
// message notifications with the page's Notification API.
setUpAccountNotifications();
