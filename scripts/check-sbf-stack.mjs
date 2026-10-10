import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/check-sbf-stack.mjs <anchor-build-log>");
const output = await readFile(path, "utf8");
const failures = [
  ...(output.match(/Stack offset[^\\n]*exceeded max offset[^\\n]*/gi) ?? []),
  ...(output.match(/Error: Function [^\\n]*stolons[^\\n]*overflows the maximum allowed frame space[^\\n]*/gi) ?? []),
  ...(output.match(/Error: A function call in method [^\\n]*stolons[^\\n]*overwrites values in the frame[^\\n]*/gi) ?? []),
];
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.info("No SBF stack-frame overflow was reported by the Anchor build.");
}
