import {
  Component,
  JSX,
  createContext,
  createResource,
  onCleanup,
} from "solid-js";
import { isDev } from "../utils/isDev";

type I18NContextType = {
  t: (key: string) => string;
};

export const I18NContext = createContext<I18NContextType>({
  t: (key: string) => key,
});

export const I18NProvider: Component<{
  children: JSX.Element;
}> = (props) => {
  const [translations, { refetch: refetchTranslations }] = createResource(
    window.i18n.getTranslations
  );

  const cleanup =
    window.electronIPCHandlers.onReloadTranslations(refetchTranslations);
  onCleanup(cleanup);

  const t = (key: string) => {
    const loaded = translations();
    const value = loaded?.current?.[key];
    if (!value) {
      // Only development runs record missing keys (main ignores the rest),
      // and only once the translations are there: before that every key
      // looks missing.
      if (isDev && loaded) void window.i18n.keyMissing(key);
      return loaded?.fallback?.[key] || key;
    }
    return value;
  };

  const value = {
    t,
  };

  return (
    <I18NContext.Provider value={value}>{props.children}</I18NContext.Provider>
  );
};
