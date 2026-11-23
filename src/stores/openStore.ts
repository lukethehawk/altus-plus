import Store from "electron-store";
import { app } from "electron";
import { ensureIsolatedProfile } from "../utils/isolation";
import { openOrSetAside, setAsideUnreadableFile } from "../utils/storeRecovery";

export type SetAsideStore = {
  name: string;
  /** The file the unreadable one was renamed to, in the profile folder. */
  copy: string;
  /** For tabs: how many accounts the list was rebuilt with. */
  rebuiltTabs?: number;
};

/** Saved files set aside at this start, for the notice once the window shows. */
export const setAsideStores: SetAsideStore[] = [];

/**
 * An electron-store in the profile folder. If its file is not JSON, the file
 * is kept as <name>.corrupt-<time>.json and the store starts from its
 * defaults; afterReset may then fill it, and returns what to tell the user.
 */
export function openStore<T extends Record<string, unknown>>(
  options: { name: string; defaults: T },
  afterReset?: (store: Store<T>) => Partial<SetAsideStore>
): Store<T> {
  // Configure Electron's data directory before electron-store initializes.
  ensureIsolatedProfile();
  const cwd = app.getPath("userData");
  const { store, setAsideAs } = openOrSetAside(
    () => new Store<T>({ ...options, cwd }),
    () => setAsideUnreadableFile(cwd, options.name)
  );
  if (setAsideAs) {
    console.warn(`${options.name}.json could not be read; it was kept as ${setAsideAs}`);
    let details: Partial<SetAsideStore> = {};
    try {
      details = afterReset?.(store) ?? {};
    } catch (error) {
      console.warn(`Could not rebuild ${options.name}.json`, error);
    }
    setAsideStores.push({ ...details, name: options.name, copy: setAsideAs });
  }
  return store;
}
