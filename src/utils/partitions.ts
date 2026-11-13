import fs from "fs";
import path from "path";

/**
 * Deleting a tab's partition folder logs that WhatsApp account out for good,
 * so a folder is only deleted once the user has closed its tab: never because
 * the tab list does not mention it (the list can be lost or reset, and the
 * window then saves a fresh tab in it).
 */

/** Tab IDs (nanoid). Chromium lower-cases them for the folder names. */
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PARTITION_FOLDER = /^[a-z0-9_-]{1,64}$/;

/** Where the closed tabs wait for their folders to be deleted. */
export const CLOSED_TABS_FILE = "closed-tabs.json";

/**
 * The tab a new tab list drops: the one the user closed. The window closes one
 * tab at a time, so a list that is not a list, or drops several tabs at once,
 * returns null: that is a reset or a bug, and its tabs must keep their data.
 */
export function getClosedTabIds(savedTabIds: string[], newTabs: unknown): string[] | null {
  if (!Array.isArray(newTabs)) return null;
  const remaining = new Set<unknown>(
    newTabs.map((tab) => (tab && typeof tab === "object" ? (tab as { id?: unknown }).id : undefined))
  );
  const closed = savedTabIds.filter((id) => TAB_ID.test(id) && !remaining.has(id));
  return closed.length > 1 ? null : closed;
}

/**
 * Which partition folders to delete at startup, and which closed tabs still
 * have to wait (the last closed tab can still be reopened).
 */
export function planPartitionCleanup({
  partitionFolders,
  openTabIds,
  previouslyClosedTabId,
  closedTabIds,
}: {
  partitionFolders: string[];
  openTabIds: string[];
  previouslyClosedTabId: string | null;
  closedTabIds: string[];
}): { remove: string[]; stillClosed: string[] } {
  // An empty tab list is more likely a reset or unreadable store than a user
  // who closed every account; never delete anything because of it.
  if (openTabIds.length === 0) return { remove: [], stillClosed: closedTabIds };

  const open = new Set(openTabIds.map((id) => id.toLowerCase()));
  const reopenable = previouslyClosedTabId?.toLowerCase();
  const folders = new Set(partitionFolders.filter((name) => PARTITION_FOLDER.test(name)));
  const remove: string[] = [];
  const stillClosed: string[] = [];
  const seen = new Set<string>();
  for (const id of closedTabIds) {
    const folder = id.toLowerCase();
    if (!PARTITION_FOLDER.test(folder) || seen.has(folder)) continue;
    seen.add(folder);
    // Reopened: it is an open tab again.
    if (open.has(folder)) continue;
    if (folder === reopenable) {
      stillClosed.push(id);
      continue;
    }
    // Without a folder there is nothing left to delete.
    if (folders.has(folder)) remove.push(folder);
  }
  return { remove, stillClosed };
}

/** The closed tabs recorded in the profile; null when the file is unreadable. */
export function readClosedTabIds(profileDirectory: string): string[] | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(profileDirectory, CLOSED_TABS_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return null;
  }
  try {
    const ids: unknown = JSON.parse(text).ids;
    if (!Array.isArray(ids)) return null;
    return ids.filter((id): id is string => typeof id === "string" && TAB_ID.test(id));
  } catch {
    return null;
  }
}

/** Replaces the recorded closed tabs; a crash mid-write leaves the old file. */
export function writeClosedTabIds(profileDirectory: string, ids: string[]) {
  const file = path.join(profileDirectory, CLOSED_TABS_FILE);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ids: [...new Set(ids)] }));
  fs.renameSync(temporary, file);
}
