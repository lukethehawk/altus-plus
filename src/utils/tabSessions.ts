import { isAltusPartition } from "./security";

/**
 * Which tab a WhatsApp page belongs to, from the session it runs in: every
 * tab has its own partition, "persist:<tab ID>". A page can rewrite the tab
 * ID the window gave it (document.body.dataset.tabId), but not its session,
 * so what a page reports (unread counts, notification clicks) is credited
 * to the tab of its session.
 */
export class TabSessions<Session extends object> {
  private readonly tabIds = new WeakMap<Session, string>();

  /** When a tab's webview attaches: its session and its partition. */
  register(session: Session, partition: string): void {
    if (!isAltusPartition(partition)) return;
    this.tabIds.set(session, partition.slice("persist:".length));
  }

  tabOf(session: Session | null | undefined): string | undefined {
    return session ? this.tabIds.get(session) : undefined;
  }
}
