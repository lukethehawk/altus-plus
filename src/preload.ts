import {
  type MessageBoxOptions,
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
} from "electron";
import { ElectronTabStoreIpcApi } from "./stores/tabs/common";
import { ElectronThemeStoreIpcApi } from "./stores/themes/common";
import { ElectronSettingsStoreIpcApi } from "./stores/settings/common";
import type { ElectronIPCHandlers } from "./ipcHandlersType";

ipcRenderer.invoke("get-whatsapp-preload-path").then((preloadPath) => {
  contextBridge.exposeInMainWorld("whatsappPreloadPath", preloadPath);
});

const electronTabStoreIpcApi: ElectronTabStoreIpcApi = {
  getStore: async () => await ipcRenderer.invoke("tab-store-get"),
  set: async (key, value) =>
    await ipcRenderer.invoke("tab-store-set", key, value),
};

const electronThemeStoreIpcApi: ElectronThemeStoreIpcApi = {
  getStore: async () => await ipcRenderer.invoke("theme-store-get"),
  setThemes: async (themes) =>
    ipcRenderer.invoke("theme-store-set", "themes", themes),
};

const electronSettingsStoreIpcApi: ElectronSettingsStoreIpcApi = {
  getStore: async () => await ipcRenderer.invoke("settings-store-get"),
  setSetting: async (key, value) =>
    ipcRenderer.invoke("settings-store-set", key, value),
};

contextBridge.exposeInMainWorld("electronTabStore", electronTabStoreIpcApi);
contextBridge.exposeInMainWorld("electronThemeStore", electronThemeStoreIpcApi);
contextBridge.exposeInMainWorld(
  "electronSettingsStore",
  electronSettingsStoreIpcApi
);

/**
 * Listens to a channel from the main process and returns the remover. The
 * callback gets the message alone, not Electron's event object, which
 * carries the sender and would cross into the page.
 */
function on<Message = void>(channel: string, callback: (message: Message) => void): () => void {
  const listener = (_event: IpcRendererEvent, message: Message) => callback(message);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
}

const ipcHandlers: ElectronIPCHandlers = {
  onOpenSettings: (callback) => on("open-settings", callback),
  onEditActiveTab: (callback) => on("edit-active-tab", callback),
  onCloseActiveTab: (callback) => on("close-active-tab", callback),
  onOpenTabDevTools: (callback) => on("open-tab-devtools", callback),
  onAddNewTab: (callback) => on("add-new-tab", callback),
  onRestoreTab: (callback) => on("restore-tab", callback),
  onNextTab: (callback) => on("next-tab", callback),
  onPreviousTab: (callback) => on("previous-tab", callback),
  onFirstTab: (callback) => on("first-tab", callback),
  onLastTab: (callback) => on("last-tab", callback),
  onOpenWhatsappLink: (callback) => on("open-whatsapp-link", callback),
  whatsappLinksReady: () => ipcRenderer.invoke("whatsapp-links-ready"),
  onReloadCustomTitleBar: (callback) => on("reload-custom-title-bar", callback),
  onReloadTranslations: (callback) => on("reload-translations", callback),
  onReloadSettings: (callback) => on("reload-settings", callback),
  onNewChat: (callback) => on("new-chat", callback),
  onOpenThemeManager: (callback) => on("open-theme-manager", callback),
  onOpenResourceUsage: (callback) => on("open-resource-usage", callback),
  onOpenResourceTest: (callback) => on("open-resource-test", callback),
  onMessageCount: (callback) => on("message-count", callback),
  onSelectTab: (callback) => on("select-tab", callback),
  onDownloadCompleted: (callback) => on("download-completed", callback),
};

contextBridge.exposeInMainWorld("showDownloadInFolder", (id: number) =>
  ipcRenderer.invoke("show-download-in-folder", id)
);

contextBridge.exposeInMainWorld("electronIPCHandlers", ipcHandlers);

contextBridge.exposeInMainWorld(
  "showMessageBox",
  (options: MessageBoxOptions) => {
    return ipcRenderer.invoke("show-message-box", options);
  }
);

contextBridge.exposeInMainWorld("getResourceUsage", () =>
  ipcRenderer.invoke("get-resource-usage")
);

contextBridge.exposeInMainWorld("startResourceTest", () =>
  ipcRenderer.invoke("start-resource-test")
);

contextBridge.exposeInMainWorld("getAppMenu", () =>
  ipcRenderer.invoke("get-app-menu")
);

contextBridge.exposeInMainWorld("i18n", {
  getTranslations: () => ipcRenderer.invoke("get-translations"),
  keyMissing: (key: string) => ipcRenderer.invoke("key-missing", key),
});

contextBridge.exposeInMainWorld("clickMenuItem", (id: string) =>
  ipcRenderer.invoke("menu-item-click", id)
);

contextBridge.exposeInMainWorld("platform", process.platform);

// How the main process created this window (createWindow), not the saved
// setting: the setting applies at the next start, and the page also
// reloads its settings mid-session (language, tab menu) or after a crash.
contextBridge.exposeInMainWorld(
  "customTitlebar",
  process.argv.includes("--altus-custom-titlebar")
);

contextBridge.exposeInMainWorld("windowActions", {
  minimize: () => ipcRenderer.invoke("minimize-window"),
  maximize: () => ipcRenderer.invoke("maximize-window"),
  restore: () => ipcRenderer.invoke("restore-window"),
  close: () => ipcRenderer.invoke("close-window"),
  isMaximized: () => ipcRenderer.invoke("is-maximized"),
  isBlurred: () => ipcRenderer.invoke("is-blurred"),
  onBlurred: (callback: () => void) => on("window-blurred", callback),
  onFocused: (callback: () => void) => on("window-focused", callback),
});
