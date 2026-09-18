import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, qrPayload, renderPairingPage, secondsLeft } from "../src/pairing-ui.js";

describe("pairing-ui", () => {
  it("QR encodes pairingId only (never secrets)", () => {
    const payload = qrPayload({ pairingId: "33333333-3333-4333-8333-333333333333" });
    assert.equal(payload, "33333333-3333-4333-8333-333333333333");
  });

  it("counts down to expiry, floors at zero", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const left = secondsLeft(future);
    assert.ok(left > 50 && left <= 60);
    assert.equal(secondsLeft(new Date(Date.now() - 1000).toISOString()), 0);
  });

  it("escapes user code in HTML", () => {
    const html = renderPairingPage(
      { mode: "demo", pairingId: "p", userCode: `<img src=x onerror=alert(1)>`, expiresAt: new Date(Date.now() + 60_000).toISOString(), status: "waiting" },
      "data:image/png;base64,AAA",
    );
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes(escapeHtml("<img src=x onerror=alert(1)>")));
  });

  it("shows expired state past expiry", () => {
    const html = renderPairingPage(
      { mode: "demo", pairingId: "p", userCode: "ABC", expiresAt: new Date(Date.now() - 1000).toISOString(), status: "waiting" },
      "data:image/png;base64,AAA",
    );
    assert.ok(html.includes("Code expired"));
  });

  it("shows approved state", () => {
    const html = renderPairingPage(
      { mode: "live", pairingId: "p", userCode: "ABC", expiresAt: new Date(Date.now() + 60_000).toISOString(), status: "approved" },
      "data:image/png;base64,AAA",
    );
    assert.ok(html.includes("Approved"));
  });
});
