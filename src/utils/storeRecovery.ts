import fs from "fs";
import path from "path";

/**
 * A saved file (settings, tabs, themes, window size) that is not JSON, as a
 * power cut or a disk fault can leave it, used to stop the app at startup:
 * electron-store throws while the main script loads. Such a file is now set
 * aside under a new name and the store opens again on its defaults. Any
 * other error (a missing file reads as empty; a locked one is not lost) is
 * left as it was.
 */

/** Whether opening a store failed because its file is not JSON. */
export function isUnreadableJson(error: unknown): boolean {
  return error instanceof SyntaxError || (!!error && typeof error === "object" && (error as { name?: unknown }).name === "SyntaxError");
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** "tabs.corrupt-2026-11-23_09-05-07.json", in local time. */
export function corruptCopyName(name: string, now: Date): string {
  const date = `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
  const time = `${twoDigits(now.getHours())}-${twoDigits(now.getMinutes())}-${twoDigits(now.getSeconds())}`;
  return `${name}.corrupt-${date}_${time}.json`;
}

/**
 * Renames <name>.json in the folder to its corrupt copy name, with a number
 * added if that name is taken; returns the copy's file name.
 */
export function setAsideUnreadableFile(directory: string, name: string, now = new Date()): string {
  const first = corruptCopyName(name, now);
  let copy = first;
  for (let number = 2; fs.existsSync(path.join(directory, copy)); number++) {
    copy = first.replace(/\.json$/, `-${number}.json`);
  }
  fs.renameSync(path.join(directory, `${name}.json`), path.join(directory, copy));
  return copy;
}

/**
 * Opens a store; if its file is not JSON, sets the file aside and opens the
 * store again, which then starts from its defaults.
 */
export function openOrSetAside<S>(open: () => S, setAside: () => string): { store: S; setAsideAs: string | null } {
  try {
    return { store: open(), setAsideAs: null };
  } catch (error) {
    if (!isUnreadableJson(error)) throw error;
    const setAsideAs = setAside();
    return { store: open(), setAsideAs };
  }
}
