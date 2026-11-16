/** Where Altus + is published; used by the About dialog, links and updater. */
export const REPOSITORY_URL = "https://github.com/lukethehawk/altus-plus";

/**
 * A running app checks for a new release again after this long: started
 * with Windows, it can stay in the tray for days, and Electron security
 * releases come out every few days.
 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * How often it looks whether the last check is that old. Counting from the
 * last check (not a 6-hour timer) also covers a PC that slept: the check
 * comes within this long after it wakes up.
 */
export const UPDATE_CHECK_TICK_MS = 60 * 60 * 1000;

/**
 * Whether another background check is due. Never checked yet counts as due,
 * and so does a clock moved back, which would otherwise delay it.
 */
export function isUpdateCheckDue(
  lastCheckAt: number | null,
  now: number,
  intervalMs: number = UPDATE_CHECK_INTERVAL_MS
): boolean {
  if (lastCheckAt === null) return true;
  const elapsed = now - lastCheckAt;
  return elapsed < 0 || elapsed >= intervalMs;
}
