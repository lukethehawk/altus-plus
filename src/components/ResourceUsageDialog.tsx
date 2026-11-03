import { Dialog } from "@kobalte/core";
import {
  Accessor,
  Component,
  For,
  Setter,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  useContext,
} from "solid-js";
import CloseIcon from "../icons/CloseIcon";
import { I18NContext } from "../i18n/solid";
import { getSettingValue } from "../stores/settings/solid";
import { type ResourceGroup, totalUsage } from "../utils/resources";

const REFRESH_MS = 2000;

/** Help → Resource Usage: CPU and memory per account, refreshed while open. */
const ResourceUsageDialog: Component<{
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
}> = (props) => {
  const { t } = useContext(I18NContext);
  const [groups, setGroups] = createSignal<ResourceGroup[]>([]);
  const [copied, setCopied] = createSignal(false);

  // Nothing is measured while the panel is closed.
  createEffect(() => {
    if (!props.isOpen()) return;
    let stopped = false;
    const refresh = () =>
      window
        .getResourceUsage()
        .then((value) => {
          if (!stopped) setGroups(value);
        })
        .catch(console.error);
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    onCleanup(() => {
      stopped = true;
      clearInterval(timer);
      setCopied(false);
    });
  });

  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(getSettingValue("language"), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  const memory = (megabytes: number) => `${format(megabytes, 0)} MB`;
  const cpu = (percent: number) => `${format(percent, 1)} %`;
  const label = (group: ResourceGroup) => {
    switch (group.kind) {
      case "account":
        return group.name?.trim() || "—";
      case "window":
        return t("Altus + window");
      case "main":
        return t("Main process");
      case "gpu":
        return t("GPU");
      case "network":
        return t("Network service");
      case "audio":
        return t("Audio service");
      case "service":
        return t("Other services");
      case "workers":
        return t("WhatsApp service workers");
      default:
        return t("Other processes");
    }
  };
  const total = () => totalUsage(groups());

  const copy = () => {
    const line = (name: string, group: { cpuPercent: number; privateMB: number; processes: number }) =>
      group.processes
        ? `${name}: ${memory(group.privateMB)}, CPU ${cpu(group.cpuPercent)}`
        : `${name}: ${t("not loaded")}`;
    const text = [
      t("Resource Usage"),
      ...groups().map((group) => line(label(group), group)),
      line(t("Total"), total()),
    ].join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(console.error);
  };

  const Row: Component<{ group: ResourceGroup }> = (rowProps) => (
    <tr
      data-resource-row
      data-kind={rowProps.group.kind}
      data-tab-id={rowProps.group.tabId}
      data-private-mb={rowProps.group.privateMB}
      data-processes={rowProps.group.processes}
      class="border-t border-zinc-700/60"
    >
      <td class="py-0.5 pr-4 truncate max-w-[16rem]">{label(rowProps.group)}</td>
      <Show
        when={rowProps.group.processes}
        fallback={
          <td colSpan={2} class="py-0.5 text-right text-zinc-400">
            {t("not loaded")}
          </td>
        }
      >
        <td class="py-0.5 pr-4 text-right tabular-nums">{cpu(rowProps.group.cpuPercent)}</td>
        <td class="py-0.5 text-right tabular-nums">{memory(rowProps.group.privateMB)}</td>
      </Show>
    </tr>
  );

  return (
    <Dialog.Root open={props.isOpen()} onOpenChange={props.setIsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/30" />
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <Dialog.Content
            data-resource-usage
            class="flex flex-col z-50 bg-zinc-800 text-white border rounded border-zinc-600 min-w-[26rem] px-3.5 pt-3 pb-3 max-w-[min(calc(100vw_-_1rem),32rem)] max-h-[80vh] overflow-hidden"
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
              <Dialog.Title class="font-semibold">{t("Resource Usage")}</Dialog.Title>
              <Dialog.CloseButton
                data-resource-usage-close
                class="p-1 bg-zinc-700/50 hover:bg-zinc-600 rounded outline-none border border-transparent focus:border-zinc-300"
              >
                <CloseIcon class="w-4 h-4" />
              </Dialog.CloseButton>
            </div>
            <Dialog.Description class="overflow-y-auto text-sm">
              <table class="w-full">
                <thead>
                  <tr class="text-zinc-300">
                    <th class="pb-1 text-left font-normal" />
                    <th class="pb-1 pr-4 text-right font-normal">{t("CPU")}</th>
                    <th class="pb-1 text-right font-normal">{t("Memory")}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={groups()}>{(group) => <Row group={group} />}</For>
                </tbody>
                <tfoot>
                  <tr class="border-t-2 border-zinc-600 font-semibold">
                    <td class="py-1 pr-4">{t("Total")}</td>
                    <td class="py-1 pr-4 text-right tabular-nums">{cpu(total().cpuPercent)}</td>
                    <td class="py-1 text-right tabular-nums">{memory(total().privateMB)}</td>
                  </tr>
                </tfoot>
              </table>
              <p class="mt-2.5 text-xs text-zinc-400 leading-snug">{t("resourceUsageNote")}</p>
            </Dialog.Description>
            <div class="flex justify-end mt-3">
              <button
                class="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded outline-none border border-transparent focus:border-zinc-300 text-sm"
                onClick={copy}
              >
                {copied() ? t("Copied") : t("Copy")}
              </button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default ResourceUsageDialog;
