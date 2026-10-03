// Windows Service entry point.
//
// In a managed install this file is what sc.exe / a service wrapper (WINSW)
// launches. It is intentionally thin: all agent logic stays in index.ts so the
// service path and the foreground dev path share one implementation.
//
// Differences vs `index.ts`:
//  - No interactive pairing QR on the console (logs only); pair via `run.bat`
//    on the box or via the control panel after install.
//  - Never exits on error: a crashing service would be restarted by the SCM;
//    we mirror that loop here for dev-running services launched directly.
process.env.ORBITPC_SERVICE = '1';

try {
  await import('./index.js');
} catch (err) {
  console.error('[service] failed to boot:', err);
  process.exitCode = 1;
}
