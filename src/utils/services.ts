/**
 * The web apps a tab can show. A tab shows one service for good: its session
 * holds that service's account. What the main process allows a tab (where it
 * may navigate, which permissions it gets, which messages it may send) follows
 * the service of the tab's session, never what its page says it is.
 */
export type ServiceId = "whatsapp";

type Service = {
  /** The service's pages: https, on this host and the default port. */
  host: string;
};

export const SERVICES: Readonly<Record<ServiceId, Service>> = {
  whatsapp: { host: "web.whatsapp.com" },
};

const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[];

/** Whether an address is a page of the service. */
export function isServiceURL(service: ServiceId, value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === SERVICES[service].host &&
      (url.port === "" || url.port === "443");
  } catch {
    return false;
  }
}

/** The service an address is a page of, if any. */
export function serviceOfURL(value: unknown): ServiceId | undefined {
  if (typeof value !== "string") return undefined;
  return SERVICE_IDS.find((service) => isServiceURL(service, value));
}
