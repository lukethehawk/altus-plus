/**
 * When Altus +'s own code started running, for the resource test's startup
 * times. main.ts imports this module first, so it runs before the other
 * modules of the app (Electron and Node's built-in modules load earlier).
 */
export const mainScriptStartedAt = Date.now();
