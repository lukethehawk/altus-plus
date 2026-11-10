import { ContextMenu, Dialog } from "@kobalte/core";
import {
  Accessor,
  Component,
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  useContext,
} from "solid-js";
import {
  addTab,
  getActiveWebviewElement,
  moveTabToIndex,
  removeTab,
  restoreTab,
  setTabActive,
  tabStore,
  tabStoreLoaded,
  updateAndSyncTabStore,
} from "../stores/tabs/solid";
import { Tab, getDefaultTab } from "../stores/tabs/common";
import CloseIcon from "../icons/CloseIcon";
import SettingsIcon from "../icons/SettingsIcon";
import BellOffIcon from "../icons/BellOffIcon";
import { I18NContext } from "../i18n/solid";
import {
  HOUR_MS,
  MUTED_UNTIL_TURNED_ON,
  isMuteActive,
} from "../utils/notifications";
import TabEditDialog from "./TabEditDialog";
import { twJoin } from "tailwind-merge";
import { getSettingValue } from "../stores/settings/solid";
import NewChatDialog from "./NewChatDialog";
import WhatsAppLinkDialog from "./WhatsAppLinkDialog";
import { describeWhatsAppWebAddress } from "../utils/whatsappLinks";
import type { WebviewTag } from "electron";

interface TabComponentProps {
  tab: Tab;
  index: Accessor<number>;
  setTabToEdit: (tab: Tab | null) => void;
  removeTab: (tab: Tab) => void;
}

const [draggedTab, setDraggedTab] = createSignal<{
  id: string;
  index: number;
}>();

// Coarse clock so timed notification mutes disappear from the UI on expiry.
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 30_000);

function setNotificationsMutedUntil(tab: Tab, mutedUntil: number) {
  updateAndSyncTabStore(
    "tabs",
    (t) => t.id === tab.id,
    "config",
    "notificationsMutedUntil",
    mutedUntil
  );
}

const menuItemClass =
  "flex items-center w-full py-1.5 px-4 hover:bg-white/10 focus:bg-white/20 select-none outline-none cursor-default";

const TabComponent: Component<TabComponentProps> = (props) => {
  const [messageCount, setMessageCount] = createSignal(0);

  const cleanupListener = window.electronIPCHandlers.onMessageCount(
    ({ messageCount, tabId }) => {
      if (tabId === props.tab.id) {
        setMessageCount(messageCount);
      }
    }
  );
  onCleanup(cleanupListener);

  const [willDrop, setWillDrop] = createSignal<"before" | "after" | false>(
    false
  );
  createEffect(() => {
    if (!draggedTab()) {
      setWillDrop(false);
    }
  });
  const [isDragging, setIsDragging] = createSignal(false);
  const isSelected = () => props.tab.id === tabStore.selectedTabId;
  const { t } = useContext(I18NContext);
  const isMuted = () =>
    isMuteActive(props.tab.config.notificationsMutedUntil, now());

  let tab: HTMLDivElement | undefined;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger as="div" class="flex flex-shrink-0">
        <div
          role="tab"
          ref={tab}
          id={props.tab.id}
          aria-controls={`tabpanel-${props.tab.id}`}
          aria-selected={isSelected() ? "true" : "false"}
          class="group flex flex-shrink-0 items-center gap-1.5 bg-zinc-800 px-3 py-1.5 text-white text-sm leading-4 ui-selected:bg-zinc-700 hover:bg-zinc-600 select-none"
          classList={{
            "opacity-50": isDragging(),
            "border-l-2 border-blue-500": willDrop() === "before",
            "border-r-2 border-blue-500": willDrop() === "after",
          }}
          style={
            props.tab.config.color
              ? {
                  background: props.tab.config.color,
                }
              : {}
          }
          onClick={() => setTabActive(props.tab.id)}
          data-selected={isSelected() ? "" : undefined}
          // A string: Solid renders draggable={true} as draggable="", which
          // HTML does not treat as draggable.
          draggable={getSettingValue("tabReordering") ? "true" : "false"}
          onDragStart={(event) => {
            if (!event.dataTransfer) return;
            if (!getSettingValue("tabReordering")) {
              event.preventDefault();
              return;
            }
            setDraggedTab({
              id: props.tab.id,
              index: props.index(),
            });
            event.dataTransfer.dropEffect = "move";
            setIsDragging(true);
          }}
          onDragEnd={() => {
            setIsDragging(false);
            setDraggedTab(undefined);
            setTabActive(props.tab.id);
          }}
          onDragEnter={() => {
            const _draggedTab = draggedTab();
            if (!_draggedTab) return;
            const currentIndex = props.index();
            const draggedTabIndex = _draggedTab.index;
            if (currentIndex > draggedTabIndex) setWillDrop("after");
            else if (currentIndex < draggedTabIndex) setWillDrop("before");
            else setWillDrop(false);
          }}
          onDragLeave={(event) => {
            if (draggedTab()?.id === props.tab.id) return;
            if (
              event.relatedTarget instanceof Node &&
              tab?.contains(event.relatedTarget)
            )
              return;
            setWillDrop(false);
          }}
        >
          {!!messageCount() && (
            <div class="flex items-center justify-center leading-none w-[4ch] h-5 bg-red-600 text-white rounded-full text-[length:0.65rem] mr-0.5">
              {messageCount() > 99 ? "99+" : messageCount()}
            </div>
          )}
          <Show when={isMuted()}>
            <BellOffIcon
              class="w-3.5 h-3.5 opacity-80"
              role="img"
              aria-label={t("Notifications muted")}
            />
          </Show>
          <span>{props.tab.name}</span>
          <button
            class="flex items-center justify-center ml-0.5 w-6 h-6 hover:bg-zinc-800/50 rounded group-data-[selected]:hover:bg-zinc-800/50"
            onClick={() => {
              props.setTabToEdit(props.tab);
            }}
          >
            <SettingsIcon class="w-4 h-4" />
          </button>
          <button
            class="flex items-center justify-center w-6 h-6 hover:bg-zinc-800/50 rounded group-data-[selected]:hover:bg-zinc-800/50"
            onClick={() => {
              props.removeTab(props.tab);
            }}
          >
            <CloseIcon class="w-5 h-5" />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="z-[100] min-w-[12rem] rounded border border-zinc-700 bg-[#202224] py-1 text-[13px] text-white shadow-lg shadow-black/40 outline-none">
          <Show
            when={isMuted()}
            fallback={
              <>
                <ContextMenu.Item
                  class={menuItemClass}
                  onSelect={() =>
                    setNotificationsMutedUntil(props.tab, Date.now() + HOUR_MS)
                  }
                >
                  {t("Mute notifications for 1 hour")}
                </ContextMenu.Item>
                <ContextMenu.Item
                  class={menuItemClass}
                  onSelect={() =>
                    setNotificationsMutedUntil(
                      props.tab,
                      Date.now() + 8 * HOUR_MS
                    )
                  }
                >
                  {t("Mute notifications for 8 hours")}
                </ContextMenu.Item>
                <ContextMenu.Item
                  class={menuItemClass}
                  onSelect={() =>
                    setNotificationsMutedUntil(props.tab, MUTED_UNTIL_TURNED_ON)
                  }
                >
                  {t("Mute notifications until turned back on")}
                </ContextMenu.Item>
              </>
            }
          >
            <ContextMenu.Item
              class={menuItemClass}
              onSelect={() => setNotificationsMutedUntil(props.tab, 0)}
            >
              {t("Unmute notifications")}
            </ContextMenu.Item>
          </Show>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
};

const TabsList: Component = () => {
  const { t } = useContext(I18NContext);
  const [tabToEdit, setTabToEdit] = createSignal<Tab | null>(null);
  const canShowTabEditDialog = () => tabToEdit() !== null;

  const [canShowNewChatDialog, setShowNewChatDialog] = createSignal(false);

  // A whatsapp:// link (as a WhatsApp Web address) waiting for an account.
  const [linkToOpen, setLinkToOpen] = createSignal<string | null>(null);
  const openLinkInTab = (tabId: string, address: string) => {
    const webview = document.getElementById(`webview-${tabId}`) as WebviewTag | null;
    if (!webview) return;
    setTabActive(tabId);
    // What was opened, for the smoke test: src follows WhatsApp's redirects.
    webview.dataset.openedLink = address;
    webview.src = address;
  };
  const receiveWhatsAppLink = (address: string | null) => {
    if (!address || !describeWhatsAppWebAddress(address)) return;
    if (tabStore.tabs.length === 1) {
      openLinkInTab(tabStore.tabs[0].id, address);
    } else if (tabStore.tabs.length > 1) {
      setLinkToOpen(address);
    }
  };

  const addNewTab = () => {
    addTab(getDefaultTab());
  };

  const removeTabWithPrompt = async (tab: Tab) => {
    const requiresPrompt = getSettingValue("tabClosePrompt");
    if (!requiresPrompt) {
      removeTab(tab);
      return;
    }
    const result = await window.showMessageBox({
      type: "question",
      buttons: ["OK", t("Cancel")],
      title: t("Close Tab"),
      message: t("Are you sure you want to close the tab?"),
    });
    if (result.response === 0) {
      removeTab(tab);
    }
  };

  const handlers = new Set<() => void>();
  onCleanup(() => {
    for (const cleanup of handlers) {
      cleanup();
    }
  });

  handlers.add(
    window.electronIPCHandlers.onNextTab(() => {
      const activeTabIndex = tabStore.tabs.findIndex(
        (tab) => tab.id === tabStore.selectedTabId
      );
      if (activeTabIndex === -1) return;
      const nextIndex = activeTabIndex + 1;
      if (nextIndex >= tabStore.tabs.length) {
        setTabActive(tabStore.tabs[0].id);
        return;
      }
      setTabActive(tabStore.tabs[nextIndex].id);
    })
  );

  handlers.add(
    window.electronIPCHandlers.onPreviousTab(() => {
      const activeTabIndex = tabStore.tabs.findIndex(
        (tab) => tab.id === tabStore.selectedTabId
      );
      if (activeTabIndex === -1) return;
      const previousIndex = activeTabIndex - 1;
      if (previousIndex < 0) {
        setTabActive(tabStore.tabs[tabStore.tabs.length - 1].id);
        return;
      }
      setTabActive(tabStore.tabs[previousIndex].id);
    })
  );

  handlers.add(
    window.electronIPCHandlers.onSelectTab((tabId) => {
      if (tabStore.tabs.some((tab) => tab.id === tabId)) setTabActive(tabId);
    })
  );

  handlers.add(
    window.electronIPCHandlers.onFirstTab(() => {
      const firstTab = tabStore.tabs[0];
      if (!firstTab) return;
      setTabActive(firstTab.id);
    })
  );

  handlers.add(
    window.electronIPCHandlers.onLastTab(() => {
      const lastTab = tabStore.tabs[tabStore.tabs.length - 1];
      if (!lastTab) return;
      setTabActive(lastTab.id);
    })
  );

  handlers.add(
    window.electronIPCHandlers.onOpenWhatsappLink(receiveWhatsAppLink)
  );
  // Once the tabs are known, take the link the app was started with, if any.
  void tabStoreLoaded
    .then(() => window.electronIPCHandlers.whatsappLinksReady())
    .then(receiveWhatsAppLink);

  handlers.add(
    window.electronIPCHandlers.onOpenTabDevTools(() => {
      const activeWebview = getActiveWebviewElement();
      if (!activeWebview) return;
      activeWebview.openDevTools();
    })
  );

  handlers.add(
    window.electronIPCHandlers.onEditActiveTab(() => {
      const activeTab = tabStore.tabs.find(
        (tab) => tab.id === tabStore.selectedTabId
      );
      if (!activeTab) return;
      setTabToEdit(activeTab);
    })
  );

  handlers.add(
    window.electronIPCHandlers.onCloseActiveTab(() => {
      const activeTab = tabStore.tabs.find(
        (tab) => tab.id === tabStore.selectedTabId
      );
      if (!activeTab) return;
      removeTabWithPrompt(activeTab);
    })
  );

  handlers.add(
    window.electronIPCHandlers.onAddNewTab(() => {
      addNewTab();
    })
  );

  handlers.add(
    window.electronIPCHandlers.onRestoreTab(() => {
      restoreTab();
    })
  );

  handlers.add(
    window.electronIPCHandlers.onNewChat(() => {
      setShowNewChatDialog(true);
    })
  );

  return (
    <>
      <div
        class={twJoin(
          "bg-zinc-800 divide-x divide-zinc-700/20 w-full",
          getSettingValue("tabBar") ? "flex" : "hidden"
        )}
      >
        <div
          role="tablist"
          class="tabs-list flex overflow-x-auto"
          // Accept only a tab being dragged, not files or text.
          onDragEnter={(event) => {
            if (!event.dataTransfer) return;
            if (draggedTab()) event.preventDefault();
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer) return;
            if (draggedTab()) event.preventDefault();
          }}
          onDrop={(event) => {
            const droppedOnTab = event.target.closest('[role="tab"]');
            if (!droppedOnTab) return;
            const _draggedTab = draggedTab();
            if (!_draggedTab) return;
            const draggedTabID = _draggedTab.id;
            const droppedOnTabID = droppedOnTab.id;
            if (draggedTabID === droppedOnTabID) {
              return;
            }
            const tabs = tabStore.tabs;
            const draggedTabIndex = tabs.findIndex(
              (t) => t.id === draggedTabID
            );
            const droppedOnTabIndex = tabs.findIndex(
              (t) => t.id === droppedOnTabID
            );
            moveTabToIndex(draggedTabIndex, droppedOnTabIndex);
            event.preventDefault();
          }}
        >
          <For each={tabStore.tabs}>
            {(tab, index) => (
              <TabComponent
                tab={tab}
                index={index}
                setTabToEdit={setTabToEdit}
                removeTab={removeTabWithPrompt}
              />
            )}
          </For>
        </div>
        <button
          class="group flex items-center gap-2.5 bg-zinc-800 px-3 py-2 text-white text-sm leading-4 ui-selected:bg-zinc-700 hover:bg-zinc-600 select-none"
          onClick={addNewTab}
        >
          <div class="sr-only">{t("Add New Tab")}</div>
          <CloseIcon class="w-4 h-4 rotate-45" />
        </button>
      </div>
      <Dialog.Root
        open={canShowTabEditDialog()}
        onOpenChange={(open) => {
          if (!open) {
            setTabToEdit(null);
          }
        }}
      >
        <Show when={tabToEdit()}>
          {(tabToEdit) => (
            <TabEditDialog tabToEdit={tabToEdit} setTabToEdit={setTabToEdit} />
          )}
        </Show>
      </Dialog.Root>
      <Dialog.Root
        open={canShowNewChatDialog()}
        onOpenChange={setShowNewChatDialog}
      >
        <Show when={canShowNewChatDialog()}>
          <NewChatDialog
            close={() => {
              setShowNewChatDialog(false);
            }}
          />
        </Show>
      </Dialog.Root>
      <Dialog.Root
        open={linkToOpen() !== null}
        onOpenChange={(open) => {
          if (!open) setLinkToOpen(null);
        }}
      >
        <Show when={linkToOpen()}>
          {(address) => (
            <WhatsAppLinkDialog
              address={address()}
              open={(tabId) => {
                openLinkInTab(tabId, address());
                setLinkToOpen(null);
              }}
              close={() => setLinkToOpen(null)}
            />
          )}
        </Show>
      </Dialog.Root>
    </>
  );
};

export default TabsList;
