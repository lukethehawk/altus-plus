/**
 * whatsapp:// links, which Windows hands to Altus + on the command line once
 * it is the handler for them (Settings → "Open whatsapp:// links").
 *
 * Any web page or program can start such a link, so only the two forms
 * WhatsApp itself uses are accepted, and each becomes a fixed WhatsApp Web
 * address; anything else is ignored.
 */

export const WHATSAPP_PROTOCOL = "whatsapp";

/**
 * Arguments of the command Windows runs for a link: `"<exe>" -- "%1"`.
 * Chromium reads no switches after "--", so a link cannot pass any.
 */
export const PROTOCOL_ARGS = ["--"];

const MAX_LINK_LENGTH = 8192;
const MAX_TEXT_LENGTH = 4096;

/** The whatsapp:// link among command-line arguments, if any. */
export function findWhatsAppLink(argv: readonly string[]): string | null {
  return argv.find((arg) => /^whatsapp:/i.test(arg)) ?? null;
}

/**
 * The WhatsApp Web address for a whatsapp:// link, or null when it is not one
 * of these:
 * - whatsapp://send?phone=<number>&text=<message> (also send/?…; either part
 *   may be missing, not both): a chat, with the message ready to send;
 * - whatsapp://chat?code=<invite code> (also chat/?…): a group invite.
 */
export function whatsAppWebAddress(link: string): string | null {
  if (typeof link !== "string" || link.length > MAX_LINK_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "whatsapp:" || url.username || url.password || url.port || url.hash) return null;
  // "whatsapp://send?…" has no path and "whatsapp://send/?…" just "/".
  if (url.pathname !== "" && url.pathname !== "/") return null;
  // A repeated field would leave it unclear which value counts.
  if (["phone", "text", "code"].some((name) => url.searchParams.getAll(name).length > 1)) return null;

  switch (url.hostname.toLowerCase()) {
    case "send": {
      const rawPhone = url.searchParams.get("phone");
      const text = url.searchParams.get("text");
      const address = new URL("https://web.whatsapp.com/send");
      let empty = true;
      if (rawPhone !== null && rawPhone !== "") {
        // International format, digits only (E.164 allows up to 15).
        const phone = rawPhone.replace(/[\s+().-]/g, "");
        if (!/^\d{5,15}$/.test(phone)) return null;
        address.searchParams.set("phone", phone);
        empty = false;
      }
      if (text !== null && text !== "") {
        if (text.length > MAX_TEXT_LENGTH) return null;
        address.searchParams.set("text", text);
        empty = false;
      }
      return empty ? null : address.href;
    }
    case "chat": {
      const code = url.searchParams.get("code") ?? "";
      if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return null;
      const address = new URL("https://web.whatsapp.com/accept");
      address.searchParams.set("code", code);
      return address.href;
    }
    default:
      return null;
  }
}

/** What a WhatsApp Web address from whatsAppWebAddress opens. */
export function describeWhatsAppWebAddress(address: string):
  | { kind: "chat"; phone: string | null; text: string | null }
  | { kind: "group" }
  | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.origin !== "https://web.whatsapp.com") return null;
  if (url.pathname === "/send") {
    return { kind: "chat", phone: url.searchParams.get("phone"), text: url.searchParams.get("text") };
  }
  if (url.pathname === "/accept" && url.searchParams.has("code")) return { kind: "group" };
  return null;
}
