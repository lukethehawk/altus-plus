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
  sessions.register(alfa, "persist:smokeAlfaTab000000001");
  sessions.register(beta, "persist:smokeBetaTab000000002");
  assert.equal(sessions.tabOf(alfa), "smokeAlfaTab000000001");
  assert.equal(sessions.tabOf(beta), "smokeBetaTab000000002");
});

test("a session no tab was opened in belongs to no tab", () => {
  const sessions = new TabSessions();
  sessions.register({}, "persist:smokeAlfaTab000000001");
  assert.equal(sessions.tabOf({}), undefined);
  assert.equal(sessions.tabOf(undefined), undefined);
  assert.equal(sessions.tabOf(null), undefined);
});

test("only Altus + tab partitions are registered", () => {
  const sessions = new TabSessions();
  const cases = ["persist:../smokeEscape", "smokeAlfaTab000000001", "persist:", "", "persist:a b", `persist:${"x".repeat(65)}`];
  for (const partition of cases) {
    const session = {};
    sessions.register(session, partition);
    assert.equal(sessions.tabOf(session), undefined, partition);
  }
});

test("the tab ID keeps its case (Chromium lower-cases only the folder)", () => {
  const sessions = new TabSessions();
  const session = {};
  sessions.register(session, "persist:V1StGXR8_Z5jdHi6B-myT");
  assert.equal(sessions.tabOf(session), "V1StGXR8_Z5jdHi6B-myT");
});
