import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The app's sources import each other without extensions (Vite resolves
// them); let Node try "<path>.ts" for those.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) {
            return next(specifier + ".ts", context);
          }
          throw error;
        }
      }`)
);

const { TabSessions } = await import("../src/utils/tabSessions.ts");

test("a page's tab comes from the session it runs in", () => {
  const sessions = new TabSessions();
  const alfa = {};
  const beta = {};
  sessions.register(alfa, "persist:smokeAlfaTab000000001", "whatsapp");
  sessions.register(beta, "persist:smokeBetaTab000000002", "whatsapp");
  assert.equal(sessions.tabOf(alfa), "smokeAlfaTab000000001");
  assert.equal(sessions.tabOf(beta), "smokeBetaTab000000002");
});

test("a session no tab was opened in belongs to no tab", () => {
  const sessions = new TabSessions();
  sessions.register({}, "persist:smokeAlfaTab000000001", "whatsapp");
  assert.equal(sessions.tabOf({}), undefined);
  assert.equal(sessions.tabOf(undefined), undefined);
  assert.equal(sessions.tabOf(null), undefined);
});

test("only Altus + tab partitions are registered", () => {
  const sessions = new TabSessions();
  const cases = ["persist:../smokeEscape", "smokeAlfaTab000000001", "persist:", "", "persist:a b", `persist:${"x".repeat(65)}`];
  for (const partition of cases) {
    const session = {};
    assert.equal(sessions.register(session, partition, "whatsapp"), false, partition);
    assert.equal(sessions.tabOf(session), undefined, partition);
    assert.equal(sessions.serviceOf(session), undefined, partition);
  }
});

test("the tab ID keeps its case (Chromium lower-cases only the folder)", () => {
  const sessions = new TabSessions();
  const session = {};
  sessions.register(session, "persist:V1StGXR8_Z5jdHi6B-myT", "whatsapp");
  assert.equal(sessions.tabOf(session), "V1StGXR8_Z5jdHi6B-myT");
});

test("a tab's session keeps the service it was opened with", () => {
  const sessions = new TabSessions();
  const session = {};
  assert.equal(sessions.register(session, "persist:smokeAlfaTab000000001", "whatsapp"), true);
  assert.equal(sessions.serviceOf(session), "whatsapp");
  // The window reloads (a language change): the tab attaches again.
  assert.equal(sessions.register(session, "persist:smokeAlfaTab000000001", "whatsapp"), true);
  // Another service, or another tab, in the same session is refused and
  // changes nothing.
  assert.equal(sessions.register(session, "persist:smokeAlfaTab000000001", "telegram"), false);
  assert.equal(sessions.register(session, "persist:smokeBetaTab000000002", "whatsapp"), false);
  assert.equal(sessions.serviceOf(session), "whatsapp");
  assert.equal(sessions.tabOf(session), "smokeAlfaTab000000001");
});

test("a session no tab was opened in has no service", () => {
  const sessions = new TabSessions();
  sessions.register({}, "persist:smokeAlfaTab000000001", "whatsapp");
  assert.equal(sessions.serviceOf({}), undefined);
  assert.equal(sessions.serviceOf(undefined), undefined);
  assert.equal(sessions.serviceOf(null), undefined);
});

test("a Telegram tab's session takes no WhatsApp page", () => {
  const sessions = new TabSessions();
  const session = {};
  assert.equal(sessions.register(session, "persist:smokeTelegram00000001", "telegram"), true);
  assert.equal(sessions.serviceOf(session), "telegram");
  assert.equal(sessions.register(session, "persist:smokeTelegram00000001", "whatsapp"), false);
  assert.equal(sessions.serviceOf(session), "telegram");
});
