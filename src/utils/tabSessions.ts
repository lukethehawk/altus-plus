import { isAltusPartition } from "./security";
import type { ServiceId } from "./services";

/**
 * Which tab a page belongs to, and which service that tab shows, from the
 * session it runs in: every tab has its own partition, "persist:<tab ID>".
 * A page can rewrite the tab ID the window gave it
 * (document.body.dataset.tabId), but not its session, so what a page reports
 * (unread counts, notification clicks) is credited to the tab of its session,
 * and what it may do follows that tab's service.
 */
export class TabSessions<Session extends object> {
  private readonly tabs = new WeakMap<Session, { tabId: string; service: ServiceId }>();

  /**
   * When a tab's webview attaches: its session, its partition and the service
   * it starts on. A session keeps the first service it was registered with:
   * registering it again with another one is refused (false), and so is a
   * partition that is not a tab's.
   */
  register(session: Session, partition: string, service: ServiceId): boolean {
    if (!isAltusPartition(partition)) return false;
    const tabId = partition.slice("persist:".length);
    const known = this.tabs.get(session);
    if (known) return known.tabId === tabId && known.service === service;
    this.tabs.set(session, { tabId, service });
    return true;
  }

  tabOf(session: Session | null | undefined): string | undefined {
    return session ? this.tabs.get(session)?.tabId : undefined;
  }

  /** The service of a tab's session; undefined for a session that is no tab's. */
  serviceOf(session: Session | null | undefined): ServiceId | undefined {
    return session ? this.tabs.get(session)?.service : undefined;
  }
}
