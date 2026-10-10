import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "target/idl/stolons.json");
const destination = resolve(root, "contracts/idl/stolons.json");
await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.info(`Synced generated Anchor IDL to ${destination}`);
