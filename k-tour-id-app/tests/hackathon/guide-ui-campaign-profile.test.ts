import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

// Fresh processes exercise the real compile-time module constants, without
// injecting a production policy seam or inheriting any provider credentials.
for (const guide of [false, true]) {
  test(`campaign UI: ${guide ? "guide artifact excludes legacy entry and pending state" : "hosted artifact retains its existing legacy entry"}`, () => {
    const code = `
      import assert from "node:assert/strict";
      const c = await import("./features/ondo/hackathon-b/hackathon-campaign.ts");
      const guide = ${guide};
      const legacy = { venueId: "mois-0021cd596bc5b2a922ad", locale: "ja", resumeOperationId: "old-operation-1" };
      const explicitGuide = { ...legacy, source: "guide", returnTo: "pass", resumeOperationId: "guide-operation-1" };
      const storage = new Map(); const events = []; let timers = 0;
      globalThis.window = {
        history: { state: null },
        sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
        dispatchEvent: e => { events.push(e); return true; },
        setTimeout: () => { timers++; return 1; },
      };
      assert.equal(c.HACKATHON_ENABLED, true);
      assert.equal(c.HACKATHON_GUIDE_PRODUCTION, guide);
      assert.equal(c.HACKATHON_DEMO_ENTRY, !guide);
      assert.equal(c.isHackathonVenue(legacy.venueId), !guide);
      assert.equal(c.manualHackathonDetail(legacy) === null, guide);
      assert.deepEqual(c.manualHackathonDetail(explicitGuide), explicitGuide);
      assert.equal(c.manualHackathonDetail({ ...explicitGuide, venueId: "research-seoul-zest" }), null);
      const historical = JSON.stringify({ ...legacy, savedAt: Date.now() });
      storage.set(c.HACKATHON_PENDING_KEY, historical);
      assert.equal(c.readPendingHackathon() === null, guide);
      assert.equal(storage.get(c.HACKATHON_PENDING_KEY), historical, "do not upgrade or erase another profile's pending view");
      assert.equal(c.requestHackathonOpenB(legacy), !guide);
      assert.equal(events.length, guide ? 0 : 1);
      c.openHackathonVenueB();
      assert.equal(timers, guide ? 0 : 1, "direct convenience calls must also be inert in guide profile");
      c.writePendingHackathon(explicitGuide);
      assert.deepEqual(c.readPendingHackathon(), explicitGuide);
      assert.equal(c.requestHackathonOpenB(explicitGuide), true);
      assert.equal(events.at(-1).detail.source, "guide");
    `
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { PATH: process.env.PATH, NODE_ENV: "test", NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_DEMO_ENTRY: "1", NEXT_PUBLIC_HK_GUIDE_PRODUCTION: guide ? "1" : "0", NEXT_PUBLIC_HK_HOSTED_SUI: guide ? "0" : "1" },
      encoding: "utf8", timeout: 20_000,
    })
    assert.ifError(child.error)
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`)
  })
}
