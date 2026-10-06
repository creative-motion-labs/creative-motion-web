import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const base = process.argv[2] ?? "upstream/main";
const head = process.argv[3] ?? "HEAD";

const raw = execSync(`git diff --name-only ${base}...${head}`, { encoding: "utf8" });
const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const files = raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((path) => {
    if (path.startsWith(".next/") || path.includes("node_modules/")) return false;
    const dot = path.lastIndexOf(".");
    if (dot === -1) return false;
    return exts.has(path.slice(dot));
  })
  .sort();

const outPath = process.env.LINT_CHANGED_FILES_OUT ?? "scripts/release/lint-changed-files.txt";
writeFileSync(outPath, `${files.join("\n")}\n`);
console.log(`wrote ${files.length} paths to ${outPath} (${base}...${head})`);
