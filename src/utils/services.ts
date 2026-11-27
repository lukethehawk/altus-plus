/**
 * The web apps a tab can show. A tab shows one service for good: its session
 * holds that service's account. What the main process allows a tab (where it
 * may navigate, which permissions it gets, which messages it may send) follows
 * the service of the tab's session, never what its page says it is.
 */
export type ServiceId = "whatsapp" | "telegram";

type Service = {
  /** The service's pages: https, on this host and the default port. */
  host: string;
  /**
   * The part of the host a tab may show, as a path ending in "/": that path
   * and the pages under it. None: the whole host.
   */
  path?: string;
  /** Where a new tab of the service starts. */
  start: string;
};

export const SERVICES: Readonly<Record<ServiceId, Service>> = {
  whatsapp: { host: "web.whatsapp.com", start: "https://web.whatsapp.com" },
  // Telegram's K version only: its notifications and unread count are what
  // the Telegram preload follows. Its A version (/a/) is not opened.
  telegram: { host: "web.telegram.org", path: "/k/", start: "https://web.telegram.org/k/" },
};

export const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[];

/** As the window shows them: product names, not translated. */
export const SERVICE_NAMES: Readonly<Record<ServiceId, string>> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

/** A tab saved without a service (or with one this version does not know) shows WhatsApp. */
export const DEFAULT_SERVICE: ServiceId = "whatsapp";

function onServiceHost(service: ServiceId, value: string): URL | undefined {
  try {
    const url = new URL(value);
    const onHost = url.protocol === "https:" && url.hostname === SERVICES[service].host &&
      (url.port === "" || url.port === "443");
    return onHost ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Whether an address is a page a tab of the service may show. */
export function isServiceURL(service: ServiceId, value: string): boolean {
  const url = onServiceHost(service, value);
  if (!url) return false;
  const { path } = SERVICES[service];
  // The path without its last "/" too: the server redirects it to the path.
  return !path || url.pathname === path.slice(0, -1) || url.pathname.startsWith(path);
}

/**
 * Whether an address is on the service's host, whatever its path. Permission
 * checks name only the origin asking, so a service's permissions are trusted
 * to its whole host.
 */
export function isServiceOrigin(service: ServiceId, value: string): boolean {
  return onServiceHost(service, value) !== undefined;
}

/** The service an address is a page of, if any. */
export function serviceOfURL(value: unknown): ServiceId | undefined {
  if (typeof value !== "string") return undefined;
  return SERVICE_IDS.find((service) => isServiceURL(service, value));
}

/**
 * The service of a saved tab: its "service" field, or WhatsApp when it has
 * none (tabs of earlier versions and of the original Altus) or one this
 * version does not know.
 */
export function serviceOfTab(tab: unknown): ServiceId {
  const service = tab && typeof tab === "object" ? (tab as { service?: unknown }).service : undefined;
  return typeof service === "string" && Object.prototype.hasOwnProperty.call(SERVICES, service)
    ? (service as ServiceId)
    : DEFAULT_SERVICE;
}

/**
 * The service whose data an account folder holds, from the names of the
 * folders in its IndexedDB folder (Chromium names each after the site, as
 * https_web.telegram.org_0.indexeddb.leveldb): another service's alone, or
 * WhatsApp's, as before services, when it holds WhatsApp's, several or none.
 */
export function serviceOfIndexedDBFolders(folders: string[]): ServiceId {
  const names = new Set(folders.map((folder) => folder.toLowerCase()));
  const found = SERVICE_IDS.filter((service) => names.has(`https_${SERVICES[service].host}_0.indexeddb.leveldb`));
  return found.length === 1 ? found[0] : DEFAULT_SERVICE;
}
