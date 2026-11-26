/**
 * What a WhatsApp tab's page reports to main (src/whatsapp.preload.ts). The
 * page can be made to send anything, so main takes only plausible values.
 */

/** More unread chats than any account has: a count above it is refused. */
export const MAX_UNREAD = 100_000;

/** The unread count in a "message-count" message ({ messageCount }), or undefined if it is not a plausible one. */
export function reportedUnreadCount(detail: unknown): number | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const { messageCount } = detail as { messageCount?: unknown };
  if (typeof messageCount !== "number" || !Number.isSafeInteger(messageCount)) return undefined;
  return messageCount >= 0 && messageCount <= MAX_UNREAD ? messageCount : undefined;
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

/**
 * A tab's zoom factor after a "zoom" message: "in" (Ctrl+plus), "out"
 * (Ctrl+minus) or "reset" (Ctrl+0). Undefined for anything else.
 */
export function nextZoomFactor(current: number, change: unknown): number | undefined {
  switch (change) {
    case "in":
      return Math.min(MAX_ZOOM, current + ZOOM_STEP);
    case "out":
      return Math.max(MIN_ZOOM, current - ZOOM_STEP);
    case "reset":
      return 1;
    default:
      return undefined;
  }
}
