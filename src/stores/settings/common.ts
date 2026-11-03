import { languages } from "../../i18n/langauges.config";
import z from "zod";

export const SettingsSchema = z.object({
  tabBar: z.object({ value: z.boolean() }),
  tabBarPosition: z.object({ value: z.enum(["top", "bottom"]) }),
  tabReordering: z.object({ value: z.boolean() }),
  trayIcon: z.object({ value: z.boolean() }),
  registerProtocol: z.object({ value: z.boolean() }),
  tabClosePrompt: z.object({ value: z.boolean() }),
  closeToTray: z.object({ value: z.boolean() }),
  exitPrompt: z.object({ value: z.boolean() }),
  preventEnter: z.object({ value: z.boolean() }),
  sendWithRightShiftEnter: z.object({ value: z.boolean() }),
  notificationBadge: z.object({ value: z.boolean() }),
  launchMinimized: z.object({ value: z.boolean() }),
  launchToTray: z.object({ value: z.boolean() }),
  autoLaunch: z.object({ value: z.boolean() }),
  checkForUpdates: z.object({ value: z.boolean() }),
  autoHideMenuBar: z.object({ value: z.boolean() }),
  showSaveDialog: z.object({ value: z.boolean() }),
  defaultDownloadDir: z.object({ value: z.string() }),
  customTitlebar: z.object({ value: z.boolean() }),
  systemScrollbars: z.object({ value: z.boolean() }),
  rememberWindowSize: z.object({ value: z.boolean() }),
  rememberWindowPosition: z.object({ value: z.boolean() }),
  language: z.object({ value: z.enum(languages) }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;
export type SettingValue = {
  [Key in SettingKey]: Settings[Key]["value"];
};

export const DefaultSettingValues = {
  tabBar: true,
  tabBarPosition: "top",
  // Off so that a tab is never moved by accident: Tab menu → Allow Moving Tabs.
  tabReordering: false,
  trayIcon: true,
  registerProtocol: false,
  tabClosePrompt: true,
  closeToTray: false,
  exitPrompt: false,
  preventEnter: false,
  sendWithRightShiftEnter: false,
  notificationBadge: true,
  launchMinimized: false,
  launchToTray: false,
  autoLaunch: false,
  checkForUpdates: true,
  autoHideMenuBar: false,
  showSaveDialog: true,
  defaultDownloadDir: "",
  customTitlebar: false,
  systemScrollbars: false,
  rememberWindowSize: false,
  rememberWindowPosition: false,
  language: "en",
} as const satisfies { [Key in SettingKey]: Settings[Key]["value"] };

export const getDefaultSettings = (): Settings => ({
  tabBar: { value: DefaultSettingValues.tabBar },
  tabBarPosition: { value: DefaultSettingValues.tabBarPosition },
  tabReordering: { value: DefaultSettingValues.tabReordering },
  trayIcon: { value: DefaultSettingValues.trayIcon },
  registerProtocol: { value: DefaultSettingValues.registerProtocol },
  tabClosePrompt: { value: DefaultSettingValues.tabClosePrompt },
  closeToTray: { value: DefaultSettingValues.closeToTray },
  exitPrompt: { value: DefaultSettingValues.exitPrompt },
  preventEnter: { value: DefaultSettingValues.preventEnter },
  sendWithRightShiftEnter: { value: DefaultSettingValues.sendWithRightShiftEnter },
  notificationBadge: { value: DefaultSettingValues.notificationBadge },
  launchMinimized: { value: DefaultSettingValues.launchMinimized },
  launchToTray: { value: DefaultSettingValues.launchToTray },
  autoLaunch: { value: DefaultSettingValues.autoLaunch },
  checkForUpdates: { value: DefaultSettingValues.checkForUpdates },
  autoHideMenuBar: { value: DefaultSettingValues.autoHideMenuBar },
  showSaveDialog: { value: DefaultSettingValues.showSaveDialog },
  defaultDownloadDir: { value: DefaultSettingValues.defaultDownloadDir },
  customTitlebar: { value: DefaultSettingValues.customTitlebar },
  systemScrollbars: { value: DefaultSettingValues.systemScrollbars },
  rememberWindowSize: { value: DefaultSettingValues.rememberWindowSize },
  rememberWindowPosition: {
    value: DefaultSettingValues.rememberWindowPosition,
  },
  language: { value: DefaultSettingValues.language },
});

export type ElectronSettingsStoreIpcApi = {
  getStore: () => Promise<Settings>;
  setSetting: (
    _key: SettingKey,
    _value: SettingValue[SettingKey],
  ) => Promise<void>;
};
