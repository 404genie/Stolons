import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { Pool } from "pg";
import { decodeProgramLogs, type DecodedEvent } from "./events.js";

const rpcUrl = process.env.SOLANA_RPC_URL;
const programText = process.env.STOLONS_PROGRAM_ID;
const databaseUrl = process.env.DATABASE_URL;
if (!rpcUrl || !programText || !databaseUrl) throw new Error("Set SOLANA_RPC_URL, STOLONS_PROGRAM_ID, and DATABASE_URL.");

const programId = new PublicKey(programText);
const connection = new Connection(rpcUrl, "confirmed");
const db = new Pool({ connectionString: databaseUrl, max: 6, idleTimeoutMillis: 30_000 });
const pollMs = Math.max(1_000, Number(process.env.POLL_INTERVAL_MS || 5_000));
const START_MASS = "1000000000000000";

async function applyEvent(client: Awaited<ReturnType<typeof db.connect>>, event: DecodedEvent, signature: string, eventIndex: number, slot: number) {
  const p = event.payload;
  const val = (name: string) => p[name] === undefined ? null : String(p[name]);
  switch (event.eventName) {
    case "RootRegistered": {
      await client.query(
        `INSERT INTO families(root_mint, family_address, descendant_count, created_slot) VALUES($1,$2,0,$3) ON CONFLICT(root_mint) DO NOTHING`,
        [val("mint"), val("family"), slot]
      );
      await client.query(
        `INSERT INTO lineages(mint, root_mint, parent_mint, creator, generation, status, self_root_mass, created_slot)
         VALUES($1,$1,NULL,$2,0,'RootPending',$3,$4) ON CONFLICT(mint) DO NOTHING`,
        [val("mint"), val("creator"), START_MASS, slot]
      );
      break;
    }
    case "RootMigrated":
      await client.query("UPDATE lineages SET status='RootQualified', launch_pool=$2, cpmm_pool=$3 WHERE mint=$1", [val("mint"), val("launchPool"), val("cpmmPool")]);
      break;
    case "RootActivated":
      await client.query("UPDATE lineages SET status='RootActive' WHERE mint=$1", [val("mint")]);
      break;
    case "EpochOpened":
      await client.query(
        `INSERT INTO epochs(address,parent_mint,epoch_id,proposal_end,vote_end,status,created_slot)
         VALUES($1,$2,$3,$4,$5,'Open',$6) ON CONFLICT(address) DO NOTHING`,
        [val("epoch"), val("parentMint"), val("epochId"), val("proposalEnd"), val("voteEnd"), slot]
      );
      break;
    case "EpochClosedNoWinner":
      await client.query(
        `UPDATE epochs SET status='NoWinner' WHERE parent_mint=$1 AND epoch_id=$2::numeric`,
        [val("parentMint"), val("epochId")]
      );
      break;
    case "ProposalSubmitted":
      await client.query(
        `INSERT INTO proposals(address,epoch,child_mint,proposal_id,created_slot)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(address) DO NOTHING`,
        [val("proposal"), val("epoch"), val("childMint"), val("proposalId"), slot]
      );
      break;
    case "VoteCast":
      await client.query(
        `INSERT INTO votes(epoch,voter,proposal,amount,signature) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(epoch,voter) DO UPDATE SET proposal=EXCLUDED.proposal, amount=EXCLUDED.amount, signature=EXCLUDED.signature`,
        [val("epoch"), val("voter"), val("proposal"), val("amount"), signature]
      );
      await client.query("UPDATE proposals SET support=support+$2::numeric WHERE address=$1", [val("proposal"), val("amount")]);
      break;
    case "EpochFinalized":
      await client.query(
        `UPDATE epochs SET status='Finalized', winning_child_mint=$3, support=$4
         WHERE parent_mint=$1 AND epoch_id=$2::numeric`,
        [val("parentMint"), val("epochId"), val("childMint"), val("support")]
      );
      break;
    case "CandidateSelected":
      await client.query(
        `INSERT INTO candidates(child_mint,parent_mint,status,launch_deadline,last_slot)
         VALUES($1,$2,'Selected',$3,$4)
         ON CONFLICT(child_mint) DO UPDATE SET status='Selected',launch_deadline=EXCLUDED.launch_deadline,last_slot=EXCLUDED.last_slot`,
        [val("childMint"), val("parentMint"), val("launchDeadline"), slot]
      );
      await client.query("UPDATE lineages SET active_candidate=$2 WHERE mint=$1", [val("parentMint"), val("childMint")]);
      break;
    case "CandidateLaunched":
      await client.query("UPDATE candidates SET status='Launched',launch_pool=$2,migration_deadline=$3,last_slot=$4 WHERE child_mint=$1", [val("childMint"), val("launchPool"), val("migrationDeadline"), slot]);
      await client.query(
        `INSERT INTO lineages(mint,root_mint,parent_mint,creator,generation,status,self_root_mass,launch_pool,created_slot)
         SELECT $1,root_mint,$2,$3,generation+1,'CandidateLaunched',0,$4,$5 FROM lineages WHERE mint=$2
         ON CONFLICT(mint) DO UPDATE SET status='CandidateLaunched',launch_pool=EXCLUDED.launch_pool`,
        [val("childMint"), val("parentMint"), val("creator"), val("launchPool"), slot]
      );
      break;
    case "CandidateExpired":
      await client.query("UPDATE candidates SET status=$2,last_slot=$3 WHERE child_mint=$1", [val("childMint"), p.orphanedAfterLaunch ? "Orphan" : "Expired", slot]);
      await client.query("UPDATE lineages SET status='Orphan' WHERE mint=$1 AND $2::boolean", [val("childMint"), p.orphanedAfterLaunch]);
      await client.query("UPDATE lineages SET active_candidate=NULL WHERE mint=$1", [val("parentMint")]);
      break;
    case "CandidateMigrated":
      await client.query("UPDATE candidates SET status='Qualified',launch_pool=$2,cpmm_pool=$3,last_slot=$4 WHERE child_mint=$1", [val("childMint"), val("launchPool"), val("cpmmPool"), slot]);
      await client.query("UPDATE lineages SET status='CandidateQualified',launch_pool=$2,cpmm_pool=$3 WHERE mint=$1", [val("childMint"), val("launchPool"), val("cpmmPool")]);
      break;
    case "ReproductionReserveClaimed":
      await client.query("UPDATE lineages SET reserve_claimed=true WHERE mint=$1", [val("mint")]);
      await client.query("UPDATE candidates SET reserve_claimed=true WHERE child_mint=$1", [val("mint")]);
      break;
    case "ChildActivated":
      await client.query("UPDATE lineages SET status='DescendantActive',self_root_mass=$2,generation=$3 WHERE mint=$1", [val("childMint"), val("rootMass"), val("generation")]);
      await client.query("UPDATE lineages SET active_candidate=NULL,direct_children_count=direct_children_count+1 WHERE mint=$1", [val("parentMint")]);
      await client.query("UPDATE families SET descendant_count=descendant_count+1 WHERE root_mint=(SELECT root_mint FROM lineages WHERE mint=$1)", [val("childMint")]);
      await client.query("UPDATE candidates SET status='Settled',settled=true,last_slot=$2 WHERE child_mint=$1", [val("childMint"), slot]);
      break;
    case "ParentSupplyMutated":
      await client.query(
        `INSERT INTO mutations(signature,event_index,parent_mint,child_mint,burned,root_mass_transferred,parent_supply_after,generation,slot)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(signature,event_index) DO NOTHING`,
        [signature, eventIndex, val("parentMint"), val("childMint"), val("burned"), val("rootMassTransferred"), val("parentSupplyAfter"), val("generation"), slot]
      );
      await client.query("UPDATE lineages SET self_root_mass=self_root_mass-$2::numeric WHERE mint=$1", [val("parentMint"), val("rootMassTransferred")]);
      break;
  }
}

async function indexSignature(signature: string, slotHint: number) {
  const transaction = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!transaction) throw new Error(`RPC has not returned transaction ${signature} yet`);
  const decoded = transaction.meta?.err ? [] : decodeProgramLogs(transaction.meta?.logMessages ?? []);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < decoded.length; i += 1) {
      const event = decoded[i]!;
      const inserted = await client.query(
        `INSERT INTO protocol_events(signature,event_index,slot,block_time,event_name,payload)
         VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(signature,event_index) DO NOTHING RETURNING signature`,
        [signature, i, transaction.slot || slotHint, transaction.blockTime, event.eventName, JSON.stringify(event.payload)]
      );
      if (inserted.rowCount) await applyEvent(client, event, signature, i, transaction.slot || slotHint);
    }
    await client.query(
      `INSERT INTO indexer_state(key,value) VALUES('last_signature',$1)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
      [signature]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function catchUp() {
  const { rows } = await db.query<{ value: string }>("SELECT value FROM indexer_state WHERE key='last_signature'");
  const cursor = rows[0]?.value ?? process.env.INDEXER_START_SIGNATURE ?? null;
  const pages: ConfirmedSignatureInfo[][] = [];
  let before: string | undefined;
  let cursorFound = false;
  for (let pageNo = 0; pageNo < 1_000; pageNo += 1) {
    const options: { limit: number; before?: string } = { limit: 1_000 };
    if (before) options.before = before;
    const page = await connection.getSignaturesForAddress(programId, options, "confirmed");
    if (!page.length) break;
    pages.push(page);
    if (cursor && page.some((signature) => signature.signature === cursor)) { cursorFound = true; break; }
    before = page[page.length - 1]!.signature;
    if (page.length < 1_000) break;
  }
  if (pages.length === 1_000 && !cursorFound) throw new Error("Indexer history exceeds the pagination cap; set INDEXER_START_SIGNATURE to a checkpoint.");
  const chronological = pages.flat().reverse();
  const cursorIndex = cursorFound ? chronological.findIndex((entry) => entry.signature === cursor) : -1;
  const fresh = chronological.slice(cursorIndex + 1);
  for (const signature of fresh) await indexSignature(signature.signature, signature.slot);
}

async function main() {
  const schema = await readFile(fileURLToPath(new URL("../sql/schema.sql", import.meta.url)), "utf8");
  await db.query(schema);
  console.info(`Stolons indexer watching ${programId.toBase58()} at ${rpcUrl}`);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  while (!stopping) {
    try { await catchUp(); }
    catch (error) { console.error("Indexer poll failed:", error); }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  await db.end();
}

void main().catch(async (error) => { console.error(error); await db.end(); process.exitCode = 1; });
