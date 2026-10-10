import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { deriveLaunchLabPool } from "../sdk/src/raydium.js";
import { decodeLaunchPool } from "../sdk/src/raydium-layout.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
};

const endpoint = process.env.RPC_URL ?? clusterApiUrl("devnet");
const programId = new PublicKey(required("LAUNCHLAB_PROGRAM_ID"));
const baseMint = new PublicKey(required("BASE_MINT"));
const quoteMint = new PublicKey(required("QUOTE_MINT"));
const poolId = process.env.POOL_ID ? new PublicKey(process.env.POOL_ID) : deriveLaunchLabPool(programId, baseMint, quoteMint);
const connection = new Connection(endpoint, "confirmed");
const account = await connection.getAccountInfo(poolId, "confirmed");
if (!account) throw new Error(`No LaunchLab pool at ${poolId.toBase58()}`);
if (!account.owner.equals(programId)) throw new Error(`Pool owner mismatch: ${account.owner.toBase58()}`);
const pool = decodeLaunchPool(account.data);
const key = (value: Uint8Array) => new PublicKey(value).toBase58();
console.log(JSON.stringify({
  cluster: endpoint,
  pool: poolId.toBase58(),
  status: pool.status,
  baseDecimals: pool.baseDecimals,
  quoteDecimals: pool.quoteDecimals,
  migrateType: pool.migrateType,
  supply: pool.supply.toString(),
  totalSell: pool.totalSell.toString(),
  locked: pool.locked.toString(),
  cliff: pool.cliff.toString(),
  unlock: pool.unlock.toString(),
  vestingStart: pool.vestingStart.toString(),
  launchlabConfig: key(pool.config),
  platformConfig: key(pool.platform),
  baseMint: key(pool.baseMint),
  quoteMint: key(pool.quoteMint),
  baseVault: key(pool.baseVault),
  creator: key(pool.creator)
}, null, 2));
