import { contextBridge, ipcRenderer } from "electron";
import { isMuteActive, labelNotificationTitle } from "../notifications";

// Account-aware notifications. The page shows message notifications with the
// Notification API (Electron does not display service-worker ones) and
// attaches its own click listener, which opens the chat. Wrapping the
// constructor lets us name the account, honour a per-account mute and bring
// this tab forward on click, without touching the page's internals.
let notificationAccountName = "";
let notificationsMutedUntil = 0;

type NotificationBridge = {
  isMuted: () => boolean;
  labelTitle: (title: string) => string;
  onClick: () => void;
};

const notificationBridge: NotificationBridge = {
  isMuted: () => isMuteActive(notificationsMutedUntil, Date.now()),
  labelTitle: (title) => labelNotificationTitle(notificationAccountName, title),
  // Main brings forward the tab of this page's session.
  onClick: () => ipcRenderer.send("notification-clicked"),
};

// Serialized into the page's world: must not reference anything outside.
function installNotificationHooks(bridge: NotificationBridge) {
  const NativeNotification = window.Notification;
  if (typeof NativeNotification !== "function") return;

  class AccountNotification extends NativeNotification {
    constructor(title: string, options?: NotificationOptions) {
      if (bridge.isMuted()) {
        // Muted: hand back an inert stand-in that reports itself closed, so
        // the page's own bookkeeping for the notification still completes.
        const stub = Object.assign(new EventTarget(), {
          title: String(title),
          body: options?.body ?? "",
          tag: options?.tag ?? "",
          data: options?.data ?? null,
          onclick: null,
          onshow: null,
          onerror: null,
          onclose: null as ((event: Event) => void) | null,
          close() {
            // Nothing is shown, so there is nothing to close.
          },
        });
        setTimeout(() => {
          const event = new Event("close");
          stub.dispatchEvent(event);
          stub.onclose?.(event);
        }, 0);
        return stub as unknown as AccountNotification;
      }
      super(bridge.labelTitle(String(title)), options);
      // Only the user's click on the notification, not a click event the
      // page dispatches itself.
      this.addEventListener("click", (event) => {
        if (event.isTrusted) bridge.onClick();
      });
    }
  }

  // Keep the constructor looking like the native one to page code.
  Object.defineProperty(AccountNotification, "name", { value: "Notification" });
  Object.defineProperty(window, "Notification", {
    value: AccountNotification,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/**
 * Follows the account name and mute the window sends ("notification-config")
 * and wraps the page's Notification constructor. Call it when the preload
 * starts, before the page's own scripts run.
 */
export function setUpAccountNotifications(): void {
  ipcRenderer.on("notification-config", (_event, config: unknown) => {
    if (!config || typeof config !== "object") return;
    const { accountName, mutedUntil } = config as Record<string, unknown>;
    notificationAccountName = typeof accountName === "string" ? accountName : "";
    notificationsMutedUntil = typeof mutedUntil === "number" ? mutedUntil : 0;
  });

  contextBridge.executeInMainWorld({
    func: installNotificationHooks,
    args: [notificationBridge],
  });
}
