import { openStore } from "../openStore";
import { type ThemeStore, ThemeStoreDefaults } from "./common";

export const electronThemeStore = openStore<ThemeStore>({
  name: "themes",
  defaults: ThemeStoreDefaults(),
});
