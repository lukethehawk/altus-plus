import fs from "fs";
import path from "path";
import { app } from "electron";
import { openStore } from "../openStore";
import { readClosedTabIds } from "../../utils/partitions";
import { tabsFromPartitionFolders } from "./rebuild";
import { TabStoreDefaults, type TabStore } from "./common";

/** The folders in Partitions, without stray files. */
function partitionFolders(profileDirectory: string): string[] {
  try {
    return fs
      .readdirSync(path.join(profileDirectory, "Partitions"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export const electronTabStore = openStore<TabStore>(
  { name: "tabs", defaults: TabStoreDefaults() },
  (store) => {
    // tabs.json could not be read: the accounts come back from their folders.
    const profileDirectory = app.getPath("userData");
    const tabs = tabsFromPartitionFolders(partitionFolders(profileDirectory), readClosedTabIds(profileDirectory));
    store.set("tabs", tabs);
    if (tabs.length > 0) store.set("selectedTabId", tabs[0].id);
    return { rebuiltTabs: tabs.length };
  }
);
