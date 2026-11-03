/** Text of the tray icon tooltip: unread chats per account. */

// Windows cuts tray tooltips at 127 UTF-16 units (NOTIFYICONDATA.szTip).
export const TRAY_TOOLTIP_MAX_LENGTH = 127;
const MAX_NAME_LENGTH = 20;

export type TrayAccount = {
  name: string;
  unread: number;
  muted: boolean;
};

/**
 * One line per account, in tab order, under the app name. Names are the
 * user's own tab names: keep them on one line, without characters that
 * reorder the text, and short enough for three accounts to fit.
 */
export function formatTrayTooltip(
  title: string,
  accounts: TrayAccount[],
  mutedLabel: string
): string {
  const lines = accounts.map((account, index) => {
    const name = cleanAccountName(account.name) || `#${index + 1}`;
    const unread = Number.isSafeInteger(account.unread) && account.unread > 0 ? account.unread : 0;
    return `${name}: ${unread}${account.muted ? ` (${mutedLabel})` : ""}`;
  });
  // Drop whole lines that do not fit and end with "…" instead.
  let text = title;
  for (const [index, line] of lines.entries()) {
    const reserve = index < lines.length - 1 ? 2 : 0;
    if (text.length + 1 + line.length + reserve > TRAY_TOOLTIP_MAX_LENGTH) {
      return `${text}\n…`;
    }
    text += `\n${line}`;
  }
  return text;
}

function cleanAccountName(name: string): string {
  const characters = Array.from(
    name
      // Control characters, line breaks and bidirectional overrides.
      .replace(/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  if (characters.length <= MAX_NAME_LENGTH) return characters.join("");
  return `${characters.slice(0, MAX_NAME_LENGTH - 1).join("").trimEnd()}…`;
}
