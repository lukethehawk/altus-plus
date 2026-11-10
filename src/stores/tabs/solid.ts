import { SetStoreFunction, createStore, unwrap } from "solid-js/store";
import {
  TabStoreDefaults,
  type TabStore,
  type Tab,
  getDefaultTab,
} from "./common";
import { WebviewTag } from "electron";
import { createEffect, createMemo } from "solid-js";

const [tabStore, _updateTabStore] = createStore<TabStore>(TabStoreDefaults());

/**
 * Used to make sure the rendered webviews are not moved when a tab is drag-n-dropped.
 */
export const stableTabArray = createMemo(() => {
  return tabStore.tabs.toSorted((a, b) =>
    a.id > b.id ? 1 : a.id < b.id ? -1 : 0
  );
});

createEffect(() => {
  for (const tab of tabStore.tabs) {
    const mediaPermsValue = tab.config.media;
    if (mediaPermsValue === undefined) {
      const defaultValue = getDefaultTab().config.media;
      updateAndSyncTabStore(
        "tabs",
        (t) => t.id === tab.id,
        "config",
        "media",
        defaultValue
      );
    }
  }
});

/** Resolves once the saved tabs are in tabStore. */
export const tabStoreLoaded = window.electronTabStore.getStore().then((store) => {
  const hasNoTabsOnLoad = store.tabs.length === 0;
  if (hasNoTabsOnLoad) {
    const tab = getDefaultTab();
    store.tabs.push(tab);
    store.selectedTabId = tab.id;
  }
  const hasNoSelectedTabOnLoad = !store.selectedTabId && store.tabs.length > 0;
  if (hasNoSelectedTabOnLoad) {
    store.selectedTabId = store.tabs[0].id;
  }
  _updateTabStore(store);
  if (hasNoTabsOnLoad || hasNoSelectedTabOnLoad) {
    syncElectronTabStore();
  }
});

const updateAndSyncTabStore: SetStoreFunction<TabStore> = (
  ...args: unknown[]
) => {
  // @ts-expect-error Difficult to type, but works correctly
  _updateTabStore(...args);
  // Persist only the top-level field that changed. Switching accounts used
  // to rewrite the entire tabs array and the other two fields every time.
  const key = args[0];
  const changedKey =
    key === "tabs" || key === "selectedTabId" || key === "previouslyClosedTab"
      ? key
      : undefined;
  syncElectronTabStore(changedKey);
};

function syncElectronTabStore(changedKey?: keyof TabStore) {
  if (!changedKey || changedKey === "tabs") {
    window.electronTabStore.set("tabs", unwrap(tabStore.tabs));
  }
  if (!changedKey || changedKey === "selectedTabId") {
    window.electronTabStore.set("selectedTabId", unwrap(tabStore.selectedTabId));
  }
  if (!changedKey || changedKey === "previouslyClosedTab") {
    window.electronTabStore.set("previouslyClosedTab", unwrap(tabStore.previouslyClosedTab));
  }
}

export function addTab(tab: Tab) {
  updateAndSyncTabStore("tabs", (tabs) => [...tabs, tab]);
  updateAndSyncTabStore("selectedTabId", tab.id);
}

export function removeTab(tab: Tab) {
  updateAndSyncTabStore("tabs", (tabs) => tabs.filter((t) => t.id !== tab.id));
  updateAndSyncTabStore("previouslyClosedTab", tab);
  if (tabStore.tabs.length > 0) {
    updateAndSyncTabStore("selectedTabId", tabStore.tabs[0].id);
  } else {
    addTab(getDefaultTab());
  }
}

export function moveTabToIndex(from: number, to: number) {
  updateAndSyncTabStore("tabs", (_tabs) => {
    const tabs = _tabs.slice();
    const [splicedTab] = tabs.splice(from, 1);
    tabs.splice(to, 0, splicedTab);
    return tabs;
  });
}

export function restoreTab() {
  const previouslyClosedTab = tabStore.previouslyClosedTab;
  if (previouslyClosedTab) {
    addTab(previouslyClosedTab);
    updateAndSyncTabStore("previouslyClosedTab", null);
  }
}

export function setTabActive(id: string) {
  updateAndSyncTabStore("selectedTabId", id);
}

export function getActiveWebviewElement() {
  const webviewElement = document.getElementById(
    `webview-${tabStore.selectedTabId}`
  ) as WebviewTag | null;
  return webviewElement;
}

export { tabStore, updateAndSyncTabStore };
