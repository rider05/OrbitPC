import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCommandLog, renderPanelPage, serveControlPanel, type PanelSnapshot } from "../src/control-panel.js";

const base: PanelSnapshot = {
  computerId: "33333333-3333-4333-8333-333333333333",
  computerName: "TEST-PC",
  startedAt: new Date().toISOString(),
  connection: "online",
  credentialPresent: true,
  dryRun: true,
  allowedApps: ["notepad"],
  clipboardOptIn: false,
  allowPowerOps: true,
  recentCommands: [],
  recentAudit: [],
};

describe("control-panel", () => {
  it("command log is newest-first and bounded", () => {
    const log = createCommandLog(3);
    for (let i = 0; i < 5; i++) {
      log.push({ commandId: `cmd-${i}`, status: "succeeded", sequence: 3, at: new Date().toISOString(), errorCode: null });
    }
    const list = log.list();
    assert.equal(list.length, 3);
    assert.equal(list[0].commandId, "cmd-4");
  });

  it("escapes untrusted strings in HTML", () => {
    const html = renderPanelPage({ ...base, computerName: `<script>alert(1)</script>` });
    assert.ok(!html.includes("<script>alert(1)"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("shows offline badge and empty states", () => {
    const html = renderPanelPage({ ...base, connection: "offline", credentialPresent: false });
    assert.ok(html.includes("offline"));
    assert.ok(html.includes("MISSING"));
    assert.ok(html.includes("No commands yet"));
  });

  it("serves state JSON and handles disconnect POST", async () => {
    let disconnected = false;
    const { server, url } = await serveControlPanel(
      {
        snapshot: () => ({ ...base }),
        onDisconnect: () => {
          disconnected = true;
        },
      },
      { open: false },
    );
    try {
      const state = (await (await fetch(`${url}api/state`)).json()) as { computerId: string };
      assert.equal(state.computerId, base.computerId);
      const page = await (await fetch(url)).text();
      assert.ok(page.includes("control panel"));
      const res = await fetch(`${url}api/disconnect`, { method: "POST", body: "", redirect: "manual" });
      assert.equal(res.status, 303);
      assert.equal(disconnected, true);
      const missing = await fetch(`${url}nope`);
      assert.equal(missing.status, 404);
    } finally {
      server.close();
    }
  });
});
