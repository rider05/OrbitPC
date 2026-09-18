import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkPolicy } from "../src/policy.js";

describe("PolicyEngine default-deny", () => {
  it("allows status + lock", () => {
    assert.equal(checkPolicy({ name: "system.getStatus", args: {}, clipboardOptIn: false, allowPowerOps: true, allowedApps: {} }).allowed, true);
    assert.equal(checkPolicy({ name: "system.lock", args: {}, clipboardOptIn: false, allowPowerOps: true, allowedApps: {} }).allowed, true);
  });
  it("denies unknown app launch", () => {
    const d = checkPolicy({ name: "app.launch", args: { appId: "evil" }, clipboardOptIn: false, allowPowerOps: true, allowedApps: { notepad: "C:\\x" } });
    assert.equal(d.allowed, false);
  });
  it("allows only allowlisted app", () => {
    const d = checkPolicy({ name: "app.launch", args: { appId: "notepad" }, clipboardOptIn: false, allowPowerOps: true, allowedApps: { notepad: "C:\\x" } });
    assert.equal(d.allowed, true);
  });
  it("clipboard requires opt-in + size cap", () => {
    assert.equal(checkPolicy({ name: "clipboard.setText", args: { text: "hi" }, clipboardOptIn: false, allowPowerOps: true, allowedApps: {} }).allowed, false);
    assert.equal(checkPolicy({ name: "clipboard.setText", args: { text: "hi" }, clipboardOptIn: true, allowPowerOps: true, allowedApps: {} }).allowed, true);
    assert.equal(checkPolicy({ name: "clipboard.setText", args: { text: "x".repeat(5000) }, clipboardOptIn: true, allowPowerOps: true, allowedApps: {} }).allowed, false);
  });
  it("notification length enforced", () => {
    assert.equal(checkPolicy({ name: "notification.show", args: { body: "x".repeat(201) }, clipboardOptIn: false, allowPowerOps: true, allowedApps: {} }).allowed, false);
  });
  it("power ops gated", () => {
    assert.equal(checkPolicy({ name: "system.restart", args: {}, clipboardOptIn: false, allowPowerOps: false, allowedApps: {} }).allowed, false);
  });
});
