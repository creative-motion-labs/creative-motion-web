/**
 * ESLint errors only, for files changed between two git refs.
 * Prerequisite: node scripts/regenerate-lint-changed-files.mjs <base> <head>
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const listPath = "scripts/release/lint-changed-files.txt";
const files = readFileSync(listPath, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

const batch = 40;
const all = [];

for (let i = 0; i < files.length; i += batch) {
  const slice = files.slice(i, i + batch);
  const cmd = `npx eslint ${slice.map((f) => JSON.stringify(f)).join(" ")} --format json`;
  try {
    const out = execSync(cmd, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    all.push(...JSON.parse(out));
  } catch (e) {
    const out = e.stdout?.toString() ?? "[]";
    try {
      all.push(...JSON.parse(out));
    } catch {
      /* ignore parse failure */
    }
  }
}

const errs = [];
for (const f of all) {
  const rel = f.filePath.replace(/^.*[\\/]creative-motion-web[\\/]/, "");
  for (const m of f.messages ?? []) {
    if (m.severity === 2) {
      errs.push({
        file: rel,
        line: m.line,
        col: m.column,
        rule: m.ruleId,
        msg: m.message,
      });
    }
  }
}

console.log(`error_count=${errs.length}`);
for (const e of errs) {
  console.log(`${e.file}:${e.line}:${e.col} ${e.rule} ${e.msg}`);
}
writeFileSync(
  "scripts/release/.lint-errors-release-changed.json",
  JSON.stringify(errs, null, 2),
);
