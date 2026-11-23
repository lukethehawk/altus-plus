import { getDefaultTab, type Tab } from "./common";
import { PARTITION_FOLDER } from "../../utils/partitions";

/**
 * The tab list rebuilt when tabs.json could not be read: one tab per account
 * folder in Partitions, named "Account 1", "Account 2"… in folder order,
 * with the switches of a new tab (notifications and sound on). The folder
 * name is the tab ID: Chromium lower-cases partition names for their
 * folders, so the lower-cased ID opens the same account, still logged in.
 * Tabs the user closed (closed-tabs.json) stay closed; if that list cannot
 * be read either, every account comes back, as one too many is better than
 * one hidden.
 */
export function tabsFromPartitionFolders(partitionFolders: string[], closedTabIds: string[] | null): Tab[] {
  const closed = new Set((closedTabIds ?? []).map((id) => id.toLowerCase()));
  return partitionFolders
    .filter((folder) => PARTITION_FOLDER.test(folder) && !closed.has(folder))
    .sort()
    .map((id, index) => ({ ...getDefaultTab(), id, name: `Account ${index + 1}` }));
}
