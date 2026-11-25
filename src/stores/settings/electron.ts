import { openStore } from "../openStore";
import { type Settings, getDefaultSettings } from "./common";

export const electronSettingsStore = openStore<Settings>({
  name: "settings",
  defaults: getDefaultSettings(),
});
