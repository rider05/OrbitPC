import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureLanToken, extractBearerToken, newLanToken, verifyLanToken } from "../src/nearby-auth.js";
import { FileSecureStore } from "../src/secure-store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function tempStore(): Promise<{ store: FileSecureStore; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-lanauth-"));
  return { store: new FileSecureStore(dir), dir };
}

describe("nearby-auth LAN token", () => {
  it("generates a 256-bit token once, then returns the stored one", async () => {
    const { store, dir } = await tempStore();
    const first = await ensureLanToken(store);
    assert.equal(first.created, true);
    assert.equal(first.token.length, 64);
    const second = await ensureLanToken(store);
    assert.equal(second.created, false);
    assert.equal(second.token, first.token);
    assert.notEqual(newLanToken(), first.token);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("verifies in constant time and fails closed", () => {
    assert.equal(verifyLanToken("abc", "abc"), true);
    assert.equal(verifyLanToken("abc", "abd"), false);
    assert.equal(verifyLanToken("short", "much-longer-token"), false);
    assert.equal(verifyLanToken(null, "abc"), false);
    assert.equal(verifyLanToken("abc", undefined), false);
    assert.equal(verifyLanToken("", ""), false);
  });

  it("extracts Bearer header first, ?token= query fallback", () => {
    assert.equal(extractBearerToken({ headers: { authorization: "Bearer tok123" }, url: "/nearby?token=other" }), "tok123");
    assert.equal(extractBearerToken({ headers: {}, url: "/nearby?token=tok123" }), "tok123");
    assert.equal(extractBearerToken({ headers: {}, url: "/nearby" }), null);
    assert.equal(extractBearerToken({ headers: { authorization: "Basic xyz" }, url: "/nearby" }), null);
  });
});
