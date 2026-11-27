import { z } from "zod";
import { TAB_ID } from "./partitions";
import type { Tab } from "../stores/tabs/common";
import { SettingsSchema, type SettingKey } from "../stores/settings/common";
import { serviceOfTab, type ServiceId } from "./services";

/**
 * What the window may save in tabs.json and themes.json ("tab-store-set" and
 * "theme-store-set"). A tab's ID names its partition folder and session, so
 * it must be a tab ID, once per list. The rest is checked loosely: a list
 * that is refused is not saved at all, so tabs and themes saved by earlier
 * versions or by the original Altus must still pass. Their fields may be
 * missing (no Microphone and Camera switch) or unknown here (messageCount),
 * and unknown fields are kept. A tab's service is not checked here either: one
 * this version does not know reads as WhatsApp (serviceOfTab), and a change of
 * service is refused by TabServiceRecord.
 */

const text = (max: number) => z.string().max(max);

const TabIdSchema = z.string().regex(TAB_ID);

const TabSchema = z.looseObject({
  id: TabIdSchema,
  name: text(500),
  config: z
    .looseObject({
      theme: text(64).nullable().optional(),
      media: z.boolean().optional(),
      notifications: z.boolean().optional(),
      sound: z.boolean().optional(),
      color: text(100).nullable().optional(),
      spellChecker: z.boolean().optional(),
      // A mute saved as Infinity by an earlier version came back as null.
      notificationsMutedUntil: z.number().nullable().optional(),
    })
    .optional(),
});

// Chromium lower-cases partition folder names, so IDs that differ only in
// case would share one folder.
const TabListSchema = z
  .array(TabSchema)
  .refine((tabs) => new Set(tabs.map((tab) => tab.id.toLowerCase())).size === tabs.length);

const TabStoreValueSchemas: Record<string, z.ZodType> = {
  tabs: TabListSchema,
  selectedTabId: TabIdSchema.optional(),
  previouslyClosedTab: TabSchema.nullable().optional(),
};

export function isValidTabStoreValue(key: unknown, value: unknown): boolean {
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(TabStoreValueSchemas, key)) return false;
  return TabStoreValueSchemas[key].safeParse(value).success;
}

const ThemeSchema = z.looseObject({
  // Only compared with the tabs' theme setting, never used as a path.
  id: text(64).min(1),
  name: text(500),
  css: text(1_000_000).optional(),
  customCSS: z.boolean().optional(),
  preset: text(64).optional(),
  colors: z.looseObject({ bg: text(100), fg: text(100), ac: text(100) }).optional(),
});

const ThemeListSchema = z.array(ThemeSchema);

export function isValidThemeStoreValue(key: unknown, value: unknown): boolean {
  return key === "themes" && ThemeListSchema.safeParse(value).success;
}

/**
 * A setting the window saves ("settings-store-set"): a key of the settings
 * schema, not one every object inherits ("__proto__", "toString"), and a
 * value that key accepts. No value (undefined) deletes the setting.
 */
export function isValidSettingUpdate(key: unknown, value: unknown): key is SettingKey {
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(SettingsSchema.shape, key)) return false;
  return value === undefined || SettingsSchema.shape[key as SettingKey].safeParse({ value }).success;
}

/**
 * The service of every tab the saved lists named in this run (the tab list and
 * the last closed tab). A tab's session holds its service's account, so the
 * window may not save the tab under another service ("tab-store-set"), not
 * even by closing it and bringing it back as another.
 */
export class TabServiceRecord {
  private readonly services = new Map<string, ServiceId>();

  /** Whether one of these tabs was recorded with another service. */
  changesService(tabs: unknown): boolean {
    return usableTabs(tabs).some((tab) => {
      const recorded = this.services.get(tab.id.toLowerCase());
      return recorded !== undefined && recorded !== serviceOfTab(tab);
    });
  }

  /** Records the service of these tabs; a tab keeps the first one recorded. */
  record(tabs: unknown): void {
    for (const tab of usableTabs(tabs)) {
      const id = tab.id.toLowerCase();
      if (!this.services.has(id)) this.services.set(id, serviceOfTab(tab));
    }
  }
}

/**
 * The saved tabs as main reads them: a list (a file of another shape reads
 * as no tabs), and only tabs whose ID can name a partition. Everything else
 * a tab holds is left to its readers, which already allow for missing
 * fields: notifications and permissions must not depend on it.
 */
export function usableTabs(value: unknown): Tab[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (tab): tab is Tab =>
      !!tab && typeof tab === "object" && typeof (tab as { id?: unknown }).id === "string" && TAB_ID.test((tab as { id: string }).id)
  );
}
