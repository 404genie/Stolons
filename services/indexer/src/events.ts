import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export interface DecodedEvent {
  eventName: string;
  payload: Record<string, string | number | boolean | null>;
}

const EVENT_NAMES = [
  "RootRegistered", "RootMigrated", "RootActivated", "EpochOpened", "EpochClosedNoWinner", "ProposalSubmitted", "VoteCast",
  "EpochFinalized", "CandidateSelected", "CandidateLaunched", "CandidateExpired", "CandidateMigrated",
  "ReproductionReserveClaimed", "ChildActivated", "ParentSupplyMutated"
] as const;

const DISC = new Map(EVENT_NAMES.map((name) => [
  createHash("sha256").update(`event:${name}`).digest().subarray(0, 8).toString("hex"), name
]));

class Reader {
  offset = 8;
  constructor(readonly data: Buffer) {}
  bytes(size: number): Buffer {
    const end = this.offset + size;
    if (end > this.data.length) throw new Error("truncated Anchor event");
    const value = this.data.subarray(this.offset, end);
    this.offset = end;
    return value;
  }
  pubkey(): string { return new PublicKey(this.bytes(32)).toBase58(); }
  u8(): number { return this.bytes(1)[0]!; }
  bool(): boolean { const value = this.u8(); if (value > 1) throw new Error("invalid Borsh bool"); return value === 1; }
  u64(): bigint { const value = this.data.readBigUInt64LE(this.offset); this.bytes(8); return value; }
  i64(): bigint { const value = this.data.readBigInt64LE(this.offset); this.bytes(8); return value; }
  u128(): bigint { const low = this.u64(); const high = this.u64(); return low | (high << 64n); }
}

function key(value: string): string { return value; }

export function decodeEvent(data: Buffer): DecodedEvent | null {
  if (data.length < 8) return null;
  const eventName = DISC.get(data.subarray(0, 8).toString("hex"));
  if (!eventName) return null;
  const r = new Reader(data);
  const payload: Record<string, string | number | boolean | null> = {};
  switch (eventName) {
    case "RootRegistered": payload.mint = key(r.pubkey()); payload.creator = key(r.pubkey()); payload.family = key(r.pubkey()); break;
    case "RootMigrated": payload.mint = key(r.pubkey()); payload.launchPool = key(r.pubkey()); payload.cpmmPool = key(r.pubkey()); break;
    case "RootActivated": payload.mint = key(r.pubkey()); break;
    case "EpochOpened": payload.parentMint = key(r.pubkey()); payload.epoch = key(r.pubkey()); payload.epochId = r.u64().toString(); payload.proposalEnd = r.i64().toString(); payload.voteEnd = r.i64().toString(); break;
    case "EpochClosedNoWinner": payload.parentMint = key(r.pubkey()); payload.epochId = r.u64().toString(); break;
    case "ProposalSubmitted": payload.epoch = key(r.pubkey()); payload.proposal = key(r.pubkey()); payload.childMint = key(r.pubkey()); payload.proposalId = r.u8(); break;
    case "VoteCast": payload.epoch = key(r.pubkey()); payload.voter = key(r.pubkey()); payload.proposal = key(r.pubkey()); payload.amount = r.u64().toString(); break;
    case "EpochFinalized": payload.parentMint = key(r.pubkey()); payload.epochId = r.u64().toString(); payload.proposal = key(r.pubkey()); payload.childMint = key(r.pubkey()); payload.support = r.u64().toString(); break;
    case "CandidateSelected": payload.parentMint = key(r.pubkey()); payload.childMint = key(r.pubkey()); payload.launchDeadline = r.i64().toString(); break;
    case "CandidateLaunched": payload.parentMint = key(r.pubkey()); payload.childMint = key(r.pubkey()); payload.creator = key(r.pubkey()); payload.launchPool = key(r.pubkey()); payload.migrationDeadline = r.i64().toString(); break;
    case "CandidateExpired": payload.parentMint = key(r.pubkey()); payload.childMint = key(r.pubkey()); payload.orphanedAfterLaunch = r.bool(); break;
    case "CandidateMigrated": payload.parentMint = key(r.pubkey()); payload.childMint = key(r.pubkey()); payload.launchPool = key(r.pubkey()); payload.cpmmPool = key(r.pubkey()); break;
    case "ReproductionReserveClaimed": payload.mint = key(r.pubkey()); payload.amount = r.u64().toString(); break;
    case "ChildActivated": payload.parentMint = key(r.pubkey()); payload.childMint = key(r.pubkey()); payload.generation = r.u8(); payload.rootMass = r.u128().toString(); break;
    case "ParentSupplyMutated": payload.parentMint = key(r.pubkey()); payload.childMint = key(r.pubkey()); payload.burned = r.u64().toString(); payload.rootMassTransferred = r.u128().toString(); payload.parentSupplyAfter = r.u64().toString(); payload.generation = r.u8(); break;
  }
  if (r.offset !== data.length) throw new Error(`${eventName} has ${data.length - r.offset} unparsed bytes`);
  return { eventName, payload };
}

export function decodeProgramLogs(logs: readonly string[]): DecodedEvent[] {
  const decoded: DecodedEvent[] = [];
  for (const line of logs) {
    const prefix = "Program data: ";
    const at = line.indexOf(prefix);
    if (at < 0) continue;
    try {
      const event = decodeEvent(Buffer.from(line.slice(at + prefix.length).trim(), "base64"));
      if (event) decoded.push(event);
    } catch (error) {
      throw new Error(`failed to decode Stolons event log: ${String(error)}`);
    }
  }
  return decoded;
}
