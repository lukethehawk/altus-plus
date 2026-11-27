/**
 * What a tab may use, from its own switches (Edit Tab →
 * Notifications, Microphone and Camera). The main process answers with
 * these from the moment the tab's session exists: Electron grants every
 * request a session has no handler for.
 */

/** The switches of a saved tab that permissions follow. */
export type TabPermissionSwitches = { notifications?: unknown; media?: unknown } | undefined;

/** Permissions a tab's switches decide; every other request is refused. */
const SWITCHED_PERMISSIONS = new Set(["notifications", "media"]);

function switchAllows(permission: string, switches: TabPermissionSwitches): boolean {
  if (!switches) return false;
  // A switch that was never saved is on, as for a new tab.
  if (permission === "notifications") return switches.notifications !== false;
  if (permission === "media") return switches.media !== false;
  return false;
}

/**
 * A request (Notification.requestPermission, getUserMedia, geolocation…):
 * only from a page of the tab's service, only for notifications or the microphone and
 * camera, and only while the tab's switch is on.
 */
export function allowPermissionRequest(
  permission: string,
  fromService: boolean,
  switches: TabPermissionSwitches
): boolean {
  return fromService && SWITCHED_PERMISSIONS.has(permission) && switchAllows(permission, switches);
}

/**
 * A check (Notification.permission, navigator.permissions.query): the
 * switched permissions report what a request would get. Other checks keep
 * Electron's default answer, which reports them as allowed; asking for them
 * still goes through allowPermissionRequest, which refuses.
 */
export function allowPermissionCheck(
  permission: string,
  fromService: boolean,
  switches: TabPermissionSwitches
): boolean {
  if (!SWITCHED_PERMISSIONS.has(permission)) return true;
  return allowPermissionRequest(permission, fromService, switches);
}
