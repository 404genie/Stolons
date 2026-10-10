import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/check-sbf-stack.mjs <anchor-build-log>");
const output = await readFile(path, "utf8");
const failures = output.match(/Stack offset[^\n]*exceeded max offset[^\n]*/gi) ?? [];
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.info("No SBF stack-frame overflow was reported by the Anchor build.");
}
