import { Dialog } from "@kobalte/core";
import { Accessor, Component, Setter, useContext } from "solid-js";
import CloseIcon from "../icons/CloseIcon";
import { I18NContext } from "../i18n/solid";

/** Help → Run Resource Test: explains the test before restarting into it. */
const ResourceTestDialog: Component<{
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
}> = (props) => {
  const { t } = useContext(I18NContext);

  return (
    <Dialog.Root open={props.isOpen()} onOpenChange={props.setIsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/30" />
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <Dialog.Content
            data-resource-test
            class="flex flex-col z-50 bg-zinc-800 text-white border rounded border-zinc-600 px-3.5 pt-3 pb-3 max-w-[min(calc(100vw_-_1rem),30rem)] max-h-[80vh] overflow-hidden"
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
            <div class="flex items-center justify-between mb-3">
              <Dialog.Title class="font-semibold">{t("Resource Test")}</Dialog.Title>
              <Dialog.CloseButton class="p-1 bg-zinc-700/50 hover:bg-zinc-600 rounded outline-none border border-transparent focus:border-zinc-300">
                <CloseIcon class="w-4 h-4" />
              </Dialog.CloseButton>
            </div>
            <Dialog.Description class="flex flex-col gap-2.5 overflow-y-auto text-sm leading-snug">
              <p>{t("resourceTestDescription")}</p>
              <p class="text-zinc-300">{t("resourceTestUsage")}</p>
              <p class="text-zinc-300">{t("resourceTestEnd")}</p>
            </Dialog.Description>
            <div class="flex justify-end gap-2 mt-4">
              <button
                class="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded outline-none border border-transparent focus:border-zinc-300 text-sm"
                onClick={() => props.setIsOpen(false)}
              >
                {t("Cancel")}
              </button>
              <button
                data-resource-test-start
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded outline-none border border-transparent focus:border-zinc-300 text-sm font-semibold"
                onClick={() => void window.startResourceTest()}
              >
                {t("Restart and Measure")}
              </button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default ResourceTestDialog;
