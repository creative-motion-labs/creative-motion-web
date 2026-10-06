/**
 * Smoke-check PR313 QA routes on a local production server (next start).
 * Usage:
 *   node scripts/release/verify-production-qa-block.mjs http://127.0.0.1:3018
 */
const base = process.argv[2] ?? "http://127.0.0.1:3018";

const cases = [
  { path: "/qa/pr313", expect: 404 },
  { path: "/qa/pr313/rest-countdown", expect: 404 },
  { path: "/qa/pr313/nav-assessment", expect: 404 },
  { path: "/demo", expect: 200 },
  { path: "/assessment/not-a-valid-token", expect: 200 },
];

let failed = 0;
for (const { path, expect } of cases) {
  const url = `${base.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, { redirect: "manual" });
  const ok = response.status === expect;
  console.log(`${ok ? "OK" : "FAIL"} ${response.status} (expected ${expect}) ${path}`);
  if (!ok) failed += 1;
}

if (failed > 0) {
  process.exit(1);
}
