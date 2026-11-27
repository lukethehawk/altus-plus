import { Dialog } from "@kobalte/core";
import { For, useContext } from "solid-js";
import CloseIcon from "../icons/CloseIcon";
import PaperPlaneIcon from "../icons/PaperPlaneIcon";
import { I18NContext } from "../i18n/solid";
import { DEFAULT_SERVICE, SERVICE_NAMES, type ServiceId } from "../utils/services";

const buttonClass =
  "flex items-center gap-2 text-sm text-left py-1.5 px-2.5 bg-zinc-700/50 border rounded border-zinc-600 outline-none focus:border-zinc-300 select-none hover:bg-zinc-700 focus:bg-zinc-700 active:bg-zinc-700/75";

const CHOICES: ServiceId[] = ["whatsapp", "telegram"];

/**
 * Asks which service a new tab shows (Ctrl+T and "+"). WhatsApp has the
 * focus, so Enter opens a WhatsApp tab as before. A tab keeps its service.
 */
const NewTabDialog = (props: { add: (service: ServiceId) => void; close: () => void }) => {
  const { t } = useContext(I18NContext);
  let defaultButton: HTMLButtonElement | undefined;

  return (
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/30" />
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <Dialog.Content
          data-new-tab-dialog
          // In place of the dialog's first button (Close).
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            defaultButton?.focus();
          }}
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
            <Dialog.Title class="font-semibold">{t("Add New Tab")}</Dialog.Title>
            <Dialog.CloseButton class="p-1 bg-zinc-700/50 hover:bg-zinc-600 rounded outline-none border border-transparent focus:border-zinc-300">
              <CloseIcon class="w-4 h-4" />
            </Dialog.CloseButton>
          </div>
          <Dialog.Description class="pt-1.5 pb-2.5 text-sm">
            {t("Which service should the new tab open? A tab keeps its service.")}
          </Dialog.Description>
          <div class="flex flex-col gap-1.5">
            <For each={CHOICES}>
              {(service) => (
                <button
                  type="button"
                  class={buttonClass}
                  data-service={service}
                  ref={(element) => {
                    if (service === DEFAULT_SERVICE) defaultButton = element;
                  }}
                  onClick={() => props.add(service)}
                >
                  {service === "telegram" && <PaperPlaneIcon class="w-4 h-4" aria-hidden="true" />}
                  {SERVICE_NAMES[service]}
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

export default NewTabDialog;
