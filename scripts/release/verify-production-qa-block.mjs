/**
 * Smoke-check PR313 QA routes on a local production server (next start).
 * Usage:
 *   node scripts/release/verify-production-qa-block.mjs http://127.0.0.1:3018
 */
const base = process.argv[2] ?? "http://127.0.0.1:3018";

const FLOATING_NAV_MARKER = 'data-testid="pr313-floating-nav"';

const cases = [
  { path: "/qa/pr313", expect: 404 },
  { path: "/qa/pr313/rest-countdown", expect: 404 },
  { path: "/qa/pr313/nav-assessment", expect: 404 },
  { path: "/demo", expect: 200 },
  { path: "/assessment/not-a-valid-token", expect: 200, noFloatingNav: true },
  { path: "/patient/assessment/not-a-valid-token", expect: 200, noFloatingNav: true },
];

let failed = 0;
for (const { path, expect, noFloatingNav } of cases) {
  const url = `${base.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, { redirect: "manual" });
  let ok = response.status === expect;
  let detail = "";
  if (ok && noFloatingNav) {
    const html = await response.text();
    if (html.includes(FLOATING_NAV_MARKER)) {
      ok = false;
      detail = " (PR313 floating QA nav rendered)";
    }
  }
  console.log(`${ok ? "OK" : "FAIL"} ${response.status} (expected ${expect}) ${path}${detail}`);
  if (!ok) failed += 1;
}

if (failed > 0) {
  process.exit(1);
}
