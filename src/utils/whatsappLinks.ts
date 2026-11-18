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
 * A phone number as WhatsApp Web's send?phone= expects it: international
 * format, digits only (E.164 allows up to 15). Spaces, "+", brackets, dots
 * and dashes go, and so does the international prefix "00" ("0039…" is
 * "+39…"). Null when what is left is not 5 to 15 digits.
 */
export function normalizePhoneNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s+().-]/g, "").replace(/^00/, "");
  return /^\d{5,15}$/.test(digits) ? digits : null;
}

/**
 * The WhatsApp Web address of a chat with a number typed in File → Start New
 * Chat, or null when it is not a valid number. Put into the address as typed,
 * "+39 333…" reached WhatsApp as " 39 333…" (a "+" in a query is a space).
 */
export function whatsAppChatAddress(number: unknown): string | null {
  const phone = normalizePhoneNumber(number);
  if (!phone) return null;
  const address = new URL("https://web.whatsapp.com/send");
  address.searchParams.set("phone", phone);
  return address.href;
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
        const phone = normalizePhoneNumber(rawPhone);
        if (!phone) return null;
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
