import { nanoid } from "nanoid";
import { DEFAULT_SERVICE, type ServiceId } from "../../utils/services";

export type Tab = {
  id: string;
  name: string;
  /**
   * Chosen when the tab is created, never changed: read it with serviceOfTab
   * (none, as in the tabs of earlier versions, is WhatsApp).
   */
  service?: ServiceId;
  messageCount?: number;
  config: {
    theme: string;
    media: boolean;
    notifications: boolean;
    sound: boolean;
    color: string | null;
    spellChecker: boolean;
    // Epoch ms until which desktop notifications of this account are hidden.
    notificationsMutedUntil?: number;
  };
};

export type TabStore = {
  tabs: Tab[];
  previouslyClosedTab: Tab | null;
  selectedTabId: string | undefined;
};

/** A new tab of the service; a WhatsApp tab is saved without one, as before services. */
export const getDefaultTab = (service: ServiceId = DEFAULT_SERVICE): Tab => ({
  id: nanoid(),
  name: "New Tab",
  ...(service === DEFAULT_SERVICE ? {} : { service }),
  messageCount: 0,
  config: {
    theme: "dark",
    notifications: true,
    media: true,
    sound: true,
    color: null,
    spellChecker: true,
  },
});

export const TabStoreDefaults = (): TabStore => ({
  tabs: [],
  previouslyClosedTab: null,
  selectedTabId: undefined,
});

export type ElectronTabStoreIpcApi = {
  getStore: () => Promise<TabStore>;
  set: <T extends keyof TabStore>(key: T, value: TabStore[T]) => Promise<void>;
};
