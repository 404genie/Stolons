import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

test("SDK instruction builders match Anchor names, account metas, and discriminators", async () => {
  const root = new URL("../../programs/stolons/src/lib.rs", import.meta.url);
  const instructionSource = new URL("../../programs/stolons/src/instructions.rs", import.meta.url);
  const eventSource = new URL("../../programs/stolons/src/events.rs", import.meta.url);
  const eventDecoder = new URL("../../services/indexer/src/events.ts", import.meta.url);
  const sdk = new URL("../../sdk/src/builders.ts", import.meta.url);
  const [lib, instructions, events, decoder, builders] = await Promise.all([
    readFile(root, "utf8"), readFile(instructionSource, "utf8"), readFile(eventSource, "utf8"), readFile(eventDecoder, "utf8"), readFile(sdk, "utf8")
  ]);
  const programMethods = [...lib.matchAll(/pub fn ([a-z][a-z0-9_]*)\s*\(/g)].map((match) => match[1]);
  const schemaBlock = builders.match(/export const ACCOUNT_SCHEMAS = \{([\s\S]*?)\n\} as const/);
  assert.ok(schemaBlock, "SDK account schema block exists");
  const schemaNames = [...schemaBlock[1].matchAll(/^  ([a-z][a-z0-9_]*): \[/gm)].map((match) => match[1]);
  assert.equal(new Set(programMethods).size, programMethods.length, "Anchor method names must be unique");
  assert.deepEqual([...schemaNames].sort(), [...programMethods].sort());

  const discriminatorBlock = builders.match(/const DISCRIMINATORS: Record<InstructionName, readonly number\[\]> = \{([\s\S]*?)\n\};/);
  assert.ok(discriminatorBlock, "SDK discriminator table exists");
  for (const [, name, byteList] of discriminatorBlock[1].matchAll(/([a-z][a-z0-9_]*): \[([^\]]+)\]/g)) {
    const expected = [...createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)];
    const actual = byteList.split(",").map((value) => Number(value.trim()));
    assert.deepEqual(actual, expected, `${name} instruction discriminator matches Anchor`);
  }

  const contextNames = {
    initialize_config: "InitializeConfig", set_paused: "SetPaused", register_root_launch: "RegisterRootLaunch",
    register_root_migration: "RegisterRootMigration", claim_root_reproduction_reserve: "ClaimRootReproductionReserve",
    activate_root: "ActivateRoot", open_epoch: "OpenEpoch", submit_proposal: "SubmitProposal", cast_vote: "CastVote",
    finalize_epoch: "FinalizeEpoch", finalize_empty_epoch: "FinalizeEmptyEpoch", withdraw_vote: "WithdrawVote",
    register_candidate_launch: "RegisterCandidateLaunch", expire_candidate: "ExpireCandidate",
    register_candidate_migration: "RegisterCandidateMigration",
    claim_candidate_reproduction_reserve: "ClaimCandidateReproductionReserve", finalize_child: "FinalizeChild"
  };
  const entries = [...schemaBlock[1].matchAll(/^  ([a-z][a-z0-9_]*): \[/gm)];
  for (let i = 0; i < entries.length; i += 1) {
    const name = entries[i][1];
    const start = entries[i].index + entries[i][0].length;
    const end = entries[i + 1]?.index ?? schemaBlock[1].length;
    const builderEntry = [...schemaBlock[1].slice(start, end).matchAll(/\["([a-z][a-z0-9_]*)", (true|false), (true|false)\]/g)]
      .map((match) => [match[1], match[2] === "true", match[3] === "true"]);

    const contextStart = instructions.indexOf(`pub struct ${contextNames[name]}<'info> {`);
    assert.notEqual(contextStart, -1, `Anchor account context exists for ${name}`);
    const bodyStart = instructions.indexOf("\n", contextStart) + 1;
    const bodyEnd = instructions.indexOf("\n}", bodyStart);
    const contextBody = instructions.slice(bodyStart, bodyEnd);
    const anchorEntry = [];
    let attributes = "";
    for (const line of contextBody.split("\n")) {
      if (line.trim().startsWith("#")) { attributes = `${line} `; continue; }
      if (attributes && !attributes.includes(")]")) { attributes += `${line} `; continue; }
      const field = line.match(/^\s*pub ([a-z][a-z0-9_]*):\s*(.+),\s*$/);
      if (!field) continue;
      anchorEntry.push([
        field[1],
        /Signer\s*</.test(field[2]) || /\bsigner\b/.test(attributes),
        /\bmut\b|\binit\b|\binit_if_needed\b/.test(attributes)
      ]);
      attributes = "";
    }
    assert.deepEqual(builderEntry, anchorEntry, `${name} account order and signer/writable flags match Anchor: ${JSON.stringify({ builderEntry, anchorEntry })}`);
  }

  const eventNames = [...events.matchAll(/pub struct ([A-Z][A-Za-z0-9_]*)\s*\{/g)].map((match) => match[1]);
  const decodedNames = [...decoder.matchAll(/case "([A-Z][A-Za-z0-9_]*)": payload\./g)].map((match) => match[1]);
  assert.deepEqual([...decodedNames].sort(), [...eventNames].sort(), "indexer decodes every Anchor event name");
});
