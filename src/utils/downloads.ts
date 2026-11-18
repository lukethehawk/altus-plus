/**
 * Whether the download folder typed in Settings is a full path that
 * electron-dl accepts. electron-dl throws inside every download when its
 * folder is not absolute, which showed "A JavaScript error occurred in the
 * main process" for each attachment. On Windows: a drive letter and a slash
 * ("C:\Users\…") or a network share ("\\server\share"); "C:" alone or
 * "Downloads" are not. Used by the main process (process.platform) and by
 * Settings (window.platform), which warns under the field.
 */
export function isFullFolderPath(folder: unknown, platform: string): boolean {
  if (typeof folder !== "string") return false;
  if (platform === "win32") {
    return /^[A-Za-z]:[\\/]/.test(folder) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(folder);
  }
  return folder.startsWith("/");
}
