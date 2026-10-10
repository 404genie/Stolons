import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  INSTRUCTIONS_SYSVAR_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "./constants.js";
import type { InitializeConfigArgs, SubmitProposalArgs } from "./types.js";

type AccountMetaSpec = readonly [string, signer: boolean, writable: boolean];

export const ACCOUNT_SCHEMAS = {
  initialize_config: [
    ["config", false, true], ["authority", true, true], ["launchlab_program", false, false],
    ["cpmm_program", false, false], ["launchlab_config", false, false], ["platform_config", false, false],
    ["quote_mint", false, false], ["system_program", false, false]
  ],
  set_paused: [["config", false, true], ["authority", true, false]],
  register_root_launch: [
    ["config", false, false], ["family", false, true], ["lineage", false, true], ["creator", true, true],
    ["mint", false, false], ["pool_state", false, true], ["platform_config", false, false], ["vesting_record", false, true],
    ["reproduction_authority", false, true], ["vault_authority", false, false], ["reproduction_vault", false, true],
    ["quote_mint", false, false], ["launchlab_program", false, false], ["token_program", false, false],
    ["associated_token_program", false, false], ["system_program", false, false], ["instructions", false, false]
  ],
  register_root_migration: [
    ["config", false, false], ["lineage", false, true], ["mint", false, false], ["pool_state", false, false],
    ["cpmm_pool", false, false], ["launchlab_program", false, false], ["cpmm_program", false, false]
  ],
  claim_root_reproduction_reserve: [
    ["payer", true, true], ["config", false, false], ["lineage", false, true], ["mint", false, false],
    ["pool_state", false, true], ["base_vault", false, true], ["vesting_record", false, true],
    ["reproduction_authority", false, true], ["authority_ata", false, true], ["vault_authority", false, false],
    ["reproduction_vault", false, true], ["launchlab_authority", false, false], ["launchlab_program", false, false],
    ["token_program", false, false], ["associated_token_program", false, false], ["system_program", false, false]
  ],
  activate_root: [["config", false, false], ["lineage", false, true], ["mint", false, false]],
  open_epoch: [
    ["payer", true, true], ["config", false, false], ["parent", false, true], ["parent_mint", false, false],
    ["vault_authority", false, false], ["reproduction_vault", false, false], ["epoch", false, true],
    ["vote_authority", false, false], ["vote_escrow", false, true], ["token_program", false, false], ["system_program", false, false]
  ],
  submit_proposal: [
    ["proposer", true, true], ["config", false, false], ["parent", false, true], ["epoch", false, true],
    ["proposal", false, true], ["candidate", false, true], ["proposed_mint", false, true],
    ["existing_child_lineage", false, false], ["treasury", false, true], ["system_program", false, false]
  ],
  cast_vote: [
    ["voter", true, true], ["config", false, false], ["epoch", false, true], ["parent_mint", false, false],
    ["proposal", false, true], ["receipt", false, true], ["vote_authority", false, false], ["vote_escrow", false, true],
    ["voter_tokens", false, true], ["token_program", false, false], ["system_program", false, false]
  ],
  finalize_epoch: [
    ["settler", true, false], ["config", false, false], ["parent", false, true], ["parent_mint", false, false],
    ["epoch", false, true], ["proposal", false, true], ["candidate", false, true]
  ],
  finalize_empty_epoch: [
    ["settler", true, false], ["config", false, false], ["parent", false, true], ["parent_mint", false, false], ["epoch", false, true]
  ],
  withdraw_vote: [
    ["voter", true, false], ["epoch", false, false], ["parent_mint", false, false], ["receipt", false, true],
    ["vote_authority", false, false], ["vote_escrow", false, true], ["destination", false, true], ["token_program", false, false]
  ],
  register_candidate_launch: [
    ["launcher", true, true], ["config", false, false], ["parent", false, true], ["parent_mint", false, false],
    ["candidate", false, true], ["proposal", false, false], ["child_mint", false, false], ["pool_state", false, true],
    ["platform_config", false, false], ["vesting_record", false, true], ["child_lineage", false, true],
    ["family", false, true], ["root_mint", false, false], ["reproduction_authority", false, true],
    ["vault_authority", false, false], ["reproduction_vault", false, true], ["quote_mint", false, false],
    ["launchlab_program", false, false], ["token_program", false, false], ["associated_token_program", false, false],
    ["system_program", false, false], ["instructions", false, false]
  ],
  expire_candidate: [
    ["caller", true, false], ["config", false, false], ["parent", false, true], ["parent_mint", false, false],
    ["candidate", false, true], ["pool_state", false, false], ["child_lineage", false, true]
  ],
  register_candidate_migration: [
    ["config", false, false], ["parent", false, true], ["parent_mint", false, false], ["candidate", false, true],
    ["child_lineage", false, true], ["child_mint", false, false], ["pool_state", false, false], ["cpmm_pool", false, false],
    ["launchlab_program", false, false], ["cpmm_program", false, false]
  ],
  claim_candidate_reproduction_reserve: [
    ["payer", true, true], ["config", false, false], ["candidate", false, true], ["lineage", false, true], ["mint", false, false],
    ["pool_state", false, true], ["base_vault", false, true], ["vesting_record", false, true], ["reproduction_authority", false, true],
    ["authority_ata", false, true], ["vault_authority", false, false], ["reproduction_vault", false, true],
    ["launchlab_authority", false, false], ["launchlab_program", false, false], ["token_program", false, false],
    ["associated_token_program", false, false], ["system_program", false, false]
  ],
  finalize_child: [
    ["config", false, false], ["family", false, true], ["root_mint", false, false], ["parent", false, true],
    ["parent_mint", false, true], ["candidate", false, true], ["child", false, true], ["child_mint", false, false],
    ["parent_vault_authority", false, false], ["parent_reproduction_vault", false, true], ["child_vault_authority", false, false],
    ["child_reproduction_vault", false, false], ["token_program", false, false]
  ]
} as const satisfies Record<string, readonly AccountMetaSpec[]>;

export type InstructionName = keyof typeof ACCOUNT_SCHEMAS;
type AccountName<N extends InstructionName> = typeof ACCOUNT_SCHEMAS[N][number][0];
export type AccountSet<N extends InstructionName> = { [K in AccountName<N>]: PublicKey };

export interface InstructionArgs {
  initialize_config: InitializeConfigArgs;
  set_paused: boolean;
  open_epoch: bigint;
  submit_proposal: SubmitProposalArgs;
  cast_vote: bigint;
}

export const SUPPORTED_INSTRUCTIONS: readonly InstructionName[] = Object.freeze(Object.keys(ACCOUNT_SCHEMAS) as InstructionName[]);

const DISCRIMINATORS: Record<InstructionName, readonly number[]> = {
  initialize_config: [208, 127, 21, 1, 194, 190, 196, 70],
  set_paused: [91, 60, 125, 192, 176, 225, 166, 218],
  register_root_launch: [237, 154, 243, 131, 233, 145, 255, 14],
  register_root_migration: [76, 157, 89, 174, 39, 119, 209, 219],
  claim_root_reproduction_reserve: [16, 119, 214, 186, 89, 148, 223, 227],
  activate_root: [67, 150, 173, 61, 217, 174, 188, 125],
  open_epoch: [75, 57, 218, 33, 173, 254, 207, 136],
  submit_proposal: [224, 38, 210, 52, 167, 150, 221, 150],
  cast_vote: [20, 212, 15, 189, 69, 180, 69, 151],
  finalize_epoch: [159, 93, 117, 217, 63, 44, 249, 76],
  finalize_empty_epoch: [103, 124, 250, 9, 182, 76, 198, 96],
  withdraw_vote: [243, 255, 70, 200, 3, 242, 103, 137],
  register_candidate_launch: [25, 36, 102, 127, 144, 125, 19, 54],
  expire_candidate: [63, 0, 196, 220, 99, 254, 16, 190],
  register_candidate_migration: [153, 50, 142, 237, 119, 38, 126, 44],
  claim_candidate_reproduction_reserve: [57, 110, 241, 102, 117, 129, 45, 199],
  finalize_child: [146, 174, 38, 232, 180, 103, 215, 84]
};

const concat = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
};

function u64(value: bigint): Uint8Array {
  if (value < 0n || value > (1n << 64n) - 1n) throw new RangeError("argument is outside u64");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError("string is too large");
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function string(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(u32(bytes.length), bytes);
}

function serializeArgs(name: InstructionName, args: unknown): Uint8Array {
  switch (name) {
    case "initialize_config": {
      const value = args as InitializeConfigArgs;
      return concat(
        value.treasury.toBytes(), value.launchlabProgram.toBytes(), value.cpmmProgram.toBytes(), value.launchlabConfig.toBytes(),
        value.platformConfig.toBytes(), value.quoteMint.toBytes(), value.cpmmConfig.toBytes(),
        u64(value.proposalWindow), u64(value.votingWindow), u64(value.candidateLaunchWindow),
        u64(value.candidateMigrationWindow), u64(value.proposalFeeLamports)
      );
    }
    case "set_paused": return new Uint8Array([(args as boolean) ? 1 : 0]);
    case "open_epoch":
    case "cast_vote": return u64(args as bigint);
    case "submit_proposal": {
      const value = args as SubmitProposalArgs;
      if (!Number.isInteger(value.proposalId) || value.proposalId < 0 || value.proposalId > 255) throw new RangeError("proposal id is outside u8");
      if (value.metadataHash.length !== 32) throw new RangeError("metadata hash must be 32 bytes");
      return concat(
        new Uint8Array([value.proposalId]), value.childMint.toBytes(), string(value.name), string(value.symbol),
        string(value.metadataUri), value.metadataHash
      );
    }
    default: return new Uint8Array();
  }
}

export function buildInstruction<N extends InstructionName>(
  programId: PublicKey,
  name: N,
  accounts: AccountSet<N>,
  args?: N extends keyof InstructionArgs ? InstructionArgs[N] : never
): TransactionInstruction {
  const schema = ACCOUNT_SCHEMAS[name] as readonly AccountMetaSpec[];
  const keys = schema.map(([accountName, isSigner, isWritable]) => {
    const pubkey = (accounts as Record<string, PublicKey>)[accountName];
    if (!(pubkey instanceof PublicKey)) throw new TypeError(`missing or invalid account: ${accountName}`);
    return { pubkey, isSigner, isWritable };
  });
  if (name === "initialize_config" || name === "set_paused" || name === "open_epoch" || name === "submit_proposal" || name === "cast_vote") {
    if (args === undefined) throw new TypeError(`${name} requires instruction arguments`);
  }
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(concat(new Uint8Array(DISCRIMINATORS[name]), serializeArgs(name, args)))
  });
}

export function completeStandardAccounts(input: Record<string, PublicKey>): Record<string, PublicKey> {
  return {
    ...input,
    system_program: SYSTEM_PROGRAM_ID,
    token_program: TOKEN_PROGRAM_ID,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
    instructions: INSTRUCTIONS_SYSVAR_ID
  };
}

export const SystemProgramId = SystemProgram.programId;
