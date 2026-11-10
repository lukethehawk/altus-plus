import { Dialog } from "@kobalte/core";
import { For, useContext } from "solid-js";
import CloseIcon from "../icons/CloseIcon";
import { I18NContext } from "../i18n/solid";
import { tabStore } from "../stores/tabs/solid";
import { describeWhatsAppWebAddress } from "../utils/whatsappLinks";

const buttonClass =
  "text-sm text-left py-1.5 px-2.5 bg-zinc-700/50 border rounded border-zinc-600 outline-none focus:border-zinc-300 select-none hover:bg-zinc-700 focus:bg-zinc-700 active:bg-zinc-700/75";

/**
 * Asks which account opens a whatsapp:// link, so that a chat is never
 * started from the wrong number. The selected account has the focus: Enter
 * opens the link there.
 */
const WhatsAppLinkDialog = (props: {
  address: string;
  open: (tabId: string) => void;
  close: () => void;
}) => {
  const { t } = useContext(I18NContext);

  const summary = () => {
    const target = describeWhatsAppWebAddress(props.address);
    if (!target) return "";
    if (target.kind === "group") return t("Group invite");
    if (target.phone) return t("Chat with {number}").replace("{number}", `+${target.phone}`);
    return t("A message to send to a chat of your choice");
  };

  return (
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/30" />
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <Dialog.Content
          data-whatsapp-link-dialog
          class="z-50 bg-zinc-800 text-white border rounded border-zinc-600 min-w-[20rem] px-3.5 pt-3 pb-3 max-w-[min(calc(100vw_-_1rem),32rem)]"
          onPointerDownOutside={(event) => {
            if (
              (event.target as HTMLElement).closest(
                "[data-custom-titlebar],[data-custom-titlebar-menu]"
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <div class="flex items-center justify-between">
            <Dialog.Title class="font-semibold">{t("Open WhatsApp link")}</Dialog.Title>
            <Dialog.CloseButton class="p-1 bg-zinc-700/50 hover:bg-zinc-600 rounded outline-none border border-transparent focus:border-zinc-300">
              <CloseIcon class="w-4 h-4" />
            </Dialog.CloseButton>
          </div>
          <Dialog.Description class="pt-1.5 pb-2.5 text-sm">
            <div class="text-zinc-300 break-words">{summary()}</div>
            <div class="mt-2">{t("Which account should open it?")}</div>
          </Dialog.Description>
          <div class="flex flex-col gap-1.5">
            <For each={tabStore.tabs}>
              {(tab) => (
                <button
                  type="button"
                  class={buttonClass}
                  data-tab-id={tab.id}
                  aria-current={tab.id === tabStore.selectedTabId ? "true" : undefined}
                  ref={(element) => {
                    if (tab.id === tabStore.selectedTabId) {
                      setTimeout(() => element.focus(), 5);
                    }
                  }}
                  onClick={() => props.open(tab.id)}
                >
                  {tab.name}
                </button>
              )}
            </For>
            <button
              type="button"
              class={`${buttonClass} mt-1 text-zinc-300`}
              data-cancel
              onClick={() => props.close()}
            >
              {t("Cancel")}
            </button>
          </div>
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  );
};

export default WhatsAppLinkDialog;
