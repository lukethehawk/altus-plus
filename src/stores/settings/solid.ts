import { createStore } from "solid-js/store";
import {
  SettingKey,
  SettingValue,
  Settings,
  getDefaultSettings,
} from "./common";

const [settingsStore, updateSettingsStore] = createStore<Settings>(
  getDefaultSettings()
);

const loadSettingsStore = () =>
  window.electronSettingsStore.getStore().then((store) => {
    updateSettingsStore(store);
  });

void loadSettingsStore();
// The language can also change from the Edit menu, which saves it in main.
window.electronIPCHandlers.onReloadTranslations(() => void loadSettingsStore());
// So can "Allow Moving Tabs" in the Tab menu.
window.electronIPCHandlers.onReloadSettings(() => void loadSettingsStore());

export function getSettingValue<Key extends SettingKey>(
  key: Key
): SettingValue[Key] {
  const value = settingsStore[key].value;
  return value as SettingValue[Key];
}

export function setSettingValue<Key extends SettingKey>(
  key: Key,
  value: SettingValue[Key]
) {
  updateSettingsStore((prev) => ({ ...prev, [key]: { value } }));
  window.electronSettingsStore.setSetting(key, value);
}

export { settingsStore };
