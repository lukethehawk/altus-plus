/** Restrict IPC-driven navigation and access to WhatsApp session partitions. */
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

export function isTrustedWhatsAppURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "web.whatsapp.com" &&
      (url.port === "" || url.port === "443");
  } catch {
    return false;
  }
}

export function isAltusPartition(value: unknown): value is string {
  return typeof value === "string" && /^persist:[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * A message from a WhatsApp tab: a webview showing WhatsApp Web, not the app
 * window or another page. Takes Electron's WebContents.
 */
export function isWhatsAppPage(sender: { getType(): string; getURL(): string }): boolean {
  return sender.getType() === "webview" && isTrustedWhatsAppURL(sender.getURL());
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
