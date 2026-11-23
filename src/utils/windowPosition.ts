/** A rectangle in screen coordinates, as Electron's screen module gives them. */
export type ScreenArea = { x: number; y: number; width: number; height: number };

/** The height of the title bar (the custom one; the native one is about the same). */
const TITLE_BAR_HEIGHT = 32;
/**
 * How much of the title bar must be on one display to drag the window back.
 * Half its height, as Windows puts a few pixels of invisible frame above a
 * window at the top of the screen.
 */
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = TITLE_BAR_HEIGHT / 2;

/**
 * The remembered window position, if enough of the window's title bar would
 * be on the work area of a connected display to drag it; otherwise none, and
 * the window opens centred. A position remembered on a display that was then
 * disconnected opened the window where it could not be seen.
 */
export function positionOnScreen(
  saved: { x: unknown; y: unknown },
  size: { width: number; height: number },
  workAreas: ScreenArea[]
): { x: number; y: number } | undefined {
  const { x, y } = saved;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  const titleBar = { x, y, width: size.width, height: TITLE_BAR_HEIGHT };
  const minWidth = Math.min(MIN_VISIBLE_WIDTH, size.width);
  const reachable = workAreas.some((area) => {
    const width = Math.min(titleBar.x + titleBar.width, area.x + area.width) - Math.max(titleBar.x, area.x);
    const height = Math.min(titleBar.y + titleBar.height, area.y + area.height) - Math.max(titleBar.y, area.y);
    return width >= minWidth && height >= MIN_VISIBLE_HEIGHT;
  });
  return reachable ? { x, y } : undefined;
}
