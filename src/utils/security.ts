import { isServiceURL, serviceOfURL, type ServiceId } from "./services";

/** Restrict IPC-driven navigation and access to tab session partitions. */
export function getSafeExternalHttpURL(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** A WhatsApp Web address, such as the one a whatsapp:// link opens. */
export function isTrustedWhatsAppURL(value: string): boolean {
  return isServiceURL("whatsapp", value);
}

export function isAltusPartition(value: unknown): value is string {
  return typeof value === "string" && /^persist:[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * The service of a <webview> the app window may attach: one that starts on a
 * page of a service, in its own persistent partition ("will-attach-webview").
 * Anything else is refused (undefined).
 */
export function webviewService(src: unknown, partition: unknown): ServiceId | undefined {
  if (!isAltusPartition(partition)) return undefined;
  return serviceOfURL(src);
}

/**
 * Sets what every tab runs with, whatever the window asked for: the given
 * preload, no Node.js (in its frames either), context isolation and the
 * sandbox. Takes the webPreferences of "will-attach-webview".
 */
export function lockDownWebview(
  webPreferences: {
    preload?: string;
    nodeIntegration?: boolean;
    nodeIntegrationInSubFrames?: boolean;
    contextIsolation?: boolean;
    sandbox?: boolean;
  },
  preload: string
): void {
  webPreferences.preload = preload;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
}

/**
 * A message from a tab's own page: a webview showing a page of the service
 * of its session (`service`, undefined for a session that is no tab's), not
 * the app window, another site, or another service. Takes Electron's
 * WebContents.
 */
export function isServicePage(
  sender: { getType(): string; getURL(): string },
  service: ServiceId | undefined
): boolean {
  return service !== undefined && sender.getType() === "webview" && isServiceURL(service, sender.getURL());
}

/**
 * An invoke handler that only `allowed` (the app window's WebContents) may
 * call: called by any other sender, it throws and the listener does not run.
 */
export function onlyFromSender<Event extends { sender: unknown }, Args extends unknown[], Result>(
  allowed: unknown,
  channel: string,
  listener: (event: Event, ...args: Args) => Result
): (event: Event, ...args: Args) => Result {
  return (event, ...args) => {
    if (event.sender !== allowed) throw new Error(`Unauthorized IPC sender for ${channel}`);
    return listener(event, ...args);
  };
}
