import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_INSTRUCTIONS } from "../sdk/src/builders.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generated = resolve(root, "target/idl/stolons.json");
const committed = resolve(root, "contracts/idl/stolons.json");
const [builtText, committedText] = await Promise.all([readFile(generated, "utf8"), readFile(committed, "utf8")]);
if (builtText.trim() !== committedText.trim()) throw new Error("contracts/idl/stolons.json is stale; run pnpm idl:sync and commit the result");

const idl = JSON.parse(builtText) as { instructions?: Array<{ name: string }> };
if (!Array.isArray(idl.instructions)) throw new Error("generated IDL has no instructions list");
const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "");
const idlNames = idl.instructions.map((instruction) => snake(instruction.name)).sort();
const sdkNames = [...SUPPORTED_INSTRUCTIONS].sort();
if (JSON.stringify(idlNames) !== JSON.stringify(sdkNames)) {
  throw new Error(`SDK instruction builder mismatch. IDL=${idlNames.join(",")} SDK=${sdkNames.join(",")}`);
}
console.info(`IDL is synchronized; ${sdkNames.length} instruction builders are present.`);
