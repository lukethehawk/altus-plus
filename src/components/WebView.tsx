import {
  type Component,
  onMount,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import { type Tab } from "../stores/tabs/common";
import { WebviewTag } from "electron";
import { themeStore } from "../stores/themes/solid";
import { unwrap } from "solid-js/store";
import { SERVICES, serviceOfTab } from "../utils/services";

const WebView: Component<{ tab: Tab }> = (props) => {
  let webviewRef: WebviewTag | undefined;
  const [didStopLoading, setDidStopLoading] = createSignal(false);
  // Fixed for the tab's life: main refuses a tab that changes service.
  const service = serviceOfTab(props.tab);

  const selectedTheme = createMemo(() => {
    return unwrap(
      themeStore.themes.find((theme) => theme.id === props.tab.config.theme)
    );
  });

  // Themes are WhatsApp's: Telegram has its own.
  createEffect(() => {
    if (!webviewRef) return;
    if (!didStopLoading()) return;
    if (service !== "whatsapp") return;

    webviewRef.send("set-theme", selectedTheme());
  });

  createEffect(() => {
    if (!webviewRef) return;
    if (!didStopLoading()) return;

    webviewRef.setAudioMuted(!props.tab.config.sound);
  });

  // Notifications and the microphone and camera follow the tab's switches
  // in the main process (setUpTabSession), from before the page loads.

  createEffect(() => {
    if (!webviewRef) return;
    if (!didStopLoading()) return;

    webviewRef.send("set-id", props.tab.id);
  });

  createEffect(() => {
    if (!webviewRef) return;
    if (!didStopLoading()) return;

    webviewRef.send("notification-config", {
      accountName: props.tab.name,
      mutedUntil: props.tab.config.notificationsMutedUntil ?? 0,
    });
  });

  onMount(() => {
    const webview = webviewRef;

    if (!webview) {
      return;
    }

    webview.addEventListener("did-stop-loading", () => {
      setDidStopLoading(false);
      setDidStopLoading(true);
    });

    webview.addEventListener("focus", () => {
      const anyOpenTitlebarMenu = document.querySelector(
        "[data-custom-titlebar-menu] > [data-expanded]"
      );
      if (!anyOpenTitlebarMenu) return;
      anyOpenTitlebarMenu.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );
    });
  });

  return (
    <webview
      ref={webviewRef}
      class="w-full h-full"
      id={`webview-${props.tab.id}`}
      src={SERVICES[service].start}
      partition={`persist:${props.tab.id}`}
      webpreferences={`spellcheck=${props.tab.config.spellChecker}`}
    />
  );
};

export default WebView;
