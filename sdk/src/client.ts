import { Connection, PublicKey, Transaction, TransactionInstruction, type Signer } from "@solana/web3.js";
import { Buffer } from "buffer";
import { deriveLineagePda } from "./pda.js";
import { LineageStatus, type LineageAccount } from "./types.js";

const STATUS = [
  LineageStatus.RootPending,
  LineageStatus.RootQualified,
  LineageStatus.RootActive,
  LineageStatus.CandidateLaunched,
  LineageStatus.CandidateQualified,
  LineageStatus.DescendantActive,
  LineageStatus.Orphan
] as const;
const LINEAGE_DISCRIMINATOR = new Uint8Array([125, 53, 5, 134, 108, 167, 89, 101]);

function integer(data: Buffer, offset: number, size: number, signed = false): bigint {
  if (size === 8) return signed ? data.readBigInt64LE(offset) : data.readBigUInt64LE(offset);
  if (size === 16) return data.readBigUInt64LE(offset) | (data.readBigUInt64LE(offset + 8) << 64n);
  throw new Error("unsupported integer size");
}

function key(data: Buffer, offset: number): PublicKey { return new PublicKey(data.subarray(offset, offset + 32)); }

export function decodeLineage(data: Buffer | Uint8Array): LineageAccount {
  const bytes = Buffer.from(data);
  if (bytes.length < 317) throw new Error("lineage account is shorter than the pinned layout");
  if (!bytes.subarray(0, 8).equals(Buffer.from(LINEAGE_DISCRIMINATOR))) throw new Error("lineage account discriminator mismatch");
  const statusCode = bytes[137];
  if (statusCode === undefined) throw new Error("lineage account is shorter than the pinned layout");
  const status = STATUS[statusCode];
  if (!status) throw new Error("unknown lineage status");
  return {
    mint: key(bytes, 8), rootMint: key(bytes, 40), parentMint: key(bytes, 72), creator: key(bytes, 104),
    generation: bytes[136]!, status, genesisSupply: integer(bytes, 138, 8), selfRootMass: integer(bytes, 146, 16),
    directChildrenCount: bytes[162]!, activeCandidate: key(bytes, 163), activeEpoch: key(bytes, 195),
    launchPool: key(bytes, 227), cpmmPool: key(bytes, 259), reproductionReserveClaimed: bytes[291] !== 0,
    createdAt: integer(bytes, 292, 8, true), activatedAt: integer(bytes, 300, 8, true), nextEpochId: integer(bytes, 308, 8),
    bump: bytes[316]!
  };
}

export interface WalletTransactionSigner {
  publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

export class StolonsClient {
  constructor(readonly connection: Connection, readonly programId: PublicKey) {}

  async getLineage(mint: PublicKey): Promise<LineageAccount | null> {
    const account = await this.connection.getAccountInfo(deriveLineagePda(this.programId, mint), "confirmed");
    if (!account || !account.owner.equals(this.programId)) return null;
    return decodeLineage(account.data);
  }

  async send(signer: WalletTransactionSigner, instruction: TransactionInstruction, extraSigners: Signer[] = []): Promise<string> {
    const transaction = new Transaction().add(instruction);
    transaction.feePayer = signer.publicKey;
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    if (extraSigners.length) transaction.partialSign(...extraSigners);
    const signed = await signer.signTransaction(transaction);
    const signature = await this.connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
    const confirmation = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (confirmation.value.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`);
    return signature;
  }
}
