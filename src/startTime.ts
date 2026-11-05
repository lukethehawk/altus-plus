/**
 * When Altus +'s own code started running, for the resource test's startup
 * times. main.ts imports this module first, so it runs before the other
 * modules of the app (Electron and Node's built-in modules load earlier).
 */
export const mainScriptStartedAt = Date.now();

/** CPU time the main process has used so far, all threads (ms). */
export function cpuTimeMs(): number {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

/** The main process's CPU time when Altus +'s code started. */
export const mainScriptCpuMs = cpuTimeMs();
