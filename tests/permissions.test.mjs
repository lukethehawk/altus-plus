import test from "node:test";
import assert from "node:assert/strict";
import { allowPermissionCheck, allowPermissionRequest } from "../src/utils/permissions.ts";

const on = { notifications: true, media: true };
const off = { notifications: false, media: false };

test("a WhatsApp tab gets notifications and the microphone and camera while its switches are on", () => {
  assert.equal(allowPermissionRequest("notifications", true, on), true);
  assert.equal(allowPermissionRequest("media", true, on), true);
  assert.equal(allowPermissionRequest("notifications", true, off), false);
  assert.equal(allowPermissionRequest("media", true, off), false);
  assert.equal(allowPermissionRequest("notifications", true, { notifications: true, media: false }), true);
  assert.equal(allowPermissionRequest("media", true, { notifications: true, media: false }), false);
});

test("a switch that was never saved is on, as for a new tab", () => {
  // Notifications must never be lost because an older tab lacks the field.
  assert.equal(allowPermissionRequest("notifications", true, {}), true);
  assert.equal(allowPermissionRequest("media", true, { notifications: true }), true);
});

test("every other request, other pages and unknown tabs get nothing", () => {
  for (const permission of ["geolocation", "clipboard-read", "display-capture", "midi", "openExternal", "pointerLock"]) {
    assert.equal(allowPermissionRequest(permission, true, on), false, permission);
  }
  assert.equal(allowPermissionRequest("notifications", false, on), false);
  assert.equal(allowPermissionRequest("media", false, on), false);
  assert.equal(allowPermissionRequest("notifications", true, undefined), false);
});

test("checks report what a request would get for the switched permissions", () => {
  assert.equal(allowPermissionCheck("notifications", true, on), true);
  assert.equal(allowPermissionCheck("notifications", true, off), false);
  assert.equal(allowPermissionCheck("media", true, off), false);
  assert.equal(allowPermissionCheck("media", false, on), false);
  // Other checks keep Electron's default answer; their requests are refused.
  assert.equal(allowPermissionCheck("clipboard-sanitized-write", true, off), true);
});
