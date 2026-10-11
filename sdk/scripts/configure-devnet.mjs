import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { DEVNET_PROGRAM_ID, LaunchpadConfig, CpmmConfigInfoLayout, getCpmmPdaAmmConfigId, getPdaPlatformId, createPlatformConfig } from '@raydium-io/raydium-sdk-v2';
import { buildInstruction, deriveConfigPda, deriveReproductionAuthorityPda, decodePlatformConfig, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../dist/index.js';

const [walletText, programText, mode = ''] = process.argv.slice(2);
if (!walletText || !programText || !['', '--apply'].includes(mode)) throw new Error('Use bash scripts/devnet/configure.sh [--apply]');
const root = new URL('../../', import.meta.url);
const wallet = new PublicKey(walletText);
const program = new PublicKey(programText);
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const ids = DEVNET_PROGRAM_ID;
const launchpad = ids.LAUNCHPAD_PROGRAM;
const cpmm = ids.CREATE_CPMM_POOL_PROGRAM;
const launchConfig = ids.LAUNCHPAD_CONFIG;
const cpConfig = getCpmmPdaAmmConfigId(cpmm, 0).publicKey;
const platform = getPdaPlatformId(launchpad, wallet).publicKey;
const config = deriveConfigPda(program);
const reproduction = deriveReproductionAuthorityPda(program);
const quote = new PublicKey('So11111111111111111111111111111111111111112');
const discriminator = (name) => createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
const addresses = [program, launchpad, cpmm, launchConfig, cpConfig, quote, platform, config];
const accounts = await connection.getMultipleAccountsInfo(addresses);
const must = (condition, message) => { if (!condition) throw new Error(message); };
for (const i of [0, 1, 2]) {
  must(accounts[i]?.executable, `Program ${addresses[i]} is missing or not executable`);
  must(accounts[i].owner.toBase58() === 'BPFLoaderUpgradeab1e11111111111111111111111', 'Program loader mismatch');
}
must(accounts[3]?.owner.equals(launchpad), 'LaunchLab global config owner mismatch');
must(accounts[4]?.owner.equals(cpmm), 'CPMM config owner mismatch');
must(accounts[5]?.owner.equals(TOKEN_PROGRAM_ID), 'Quote mint owner mismatch');
must(accounts[3].data.subarray(0,8).equals(discriminator('GlobalConfig')), 'LaunchLab config discriminator mismatch');
must(accounts[4].data.subarray(0,8).equals(discriminator('AmmConfig')), 'CPMM config discriminator mismatch');
const launch = LaunchpadConfig.decode(accounts[3].data);
const cp = CpmmConfigInfoLayout.decode(accounts[4].data);
must(launch.mintB.equals(quote) && launch.curveType === 0, 'Expected SOL constant-product launch configuration');
must(!cp.disableCreatePool, 'CPMM pool creation disabled');
const programData = new PublicKey(accounts[0].data.subarray(4,36));
const deployed = await connection.getAccountInfo(programData);
must(deployed && deployed.owner.equals(accounts[0].owner) && deployed.data.readUInt32LE(0) === 3 && deployed.data[12] === 1 && new PublicKey(deployed.data.subarray(13,45)).equals(wallet), 'Devnet wallet does not hold the upgrade authority');

const instructions = [];
if (accounts[6]) {
  must(accounts[6].owner.equals(launchpad), 'Platform owner mismatch');
  const p = decodePlatformConfig(accounts[6].data);
  must(new PublicKey(p.feeWallet).equals(wallet) && new PublicKey(p.cpmmConfig).equals(cpConfig) && new PublicKey(p.vestingWallet).equals(reproduction), 'Existing platform has different wallet/config/vesting settings');
  must(p.migrationPlatformScale === 0n && p.migrationCreatorScale === 0n && p.migrationBurnScale === 1_000_000n && p.vestingScale === 1_000_000n, 'Existing platform has different scales');
} else {
  // Clone the SDK's BN values to avoid importing a different BN implementation.
  const bn = (value) => launch.tradeFeeRate.clone().imuln(0).iaddn(value);
  instructions.push(createPlatformConfig(launchpad, wallet, wallet, wallet, reproduction, platform, cpConfig, PublicKey.default,
    { platformScale: bn(0), creatorScale: bn(0), burnScale: bn(1_000_000) },
    bn(0), bn(0), 'Stolons Devnet', '', '', bn(1_000_000)));
}
const args = {
  treasury: wallet, launchlabProgram: launchpad, cpmmProgram: cpmm,
  launchlabConfig: launchConfig, platformConfig: platform, quoteMint: quote, cpmmConfig: cpConfig,
  proposalWindow: 60n, votingWindow: 60n, candidateLaunchWindow: 3600n,
  candidateMigrationWindow: 86400n, proposalFeeLamports: 100_000n
};
const init = buildInstruction(program, 'initialize_config', {
  config, authority: wallet, launchlab_program: launchpad, cpmm_program: cpmm,
  launchlab_config: launchConfig, platform_config: platform, quote_mint: quote, system_program: SYSTEM_PROGRAM_ID
}, args);
if (accounts[7]) {
  must(accounts[7].owner.equals(program) && accounts[7].data.subarray(0,8).equals(discriminator('GlobalConfig')), 'Existing Stolons config owner/discriminator mismatch');
  const data=accounts[7].data;
  const expectedKeys=[wallet, wallet, launchpad, cpmm, launchConfig, platform, quote, cpConfig];
  expectedKeys.forEach((key,i)=>must(new PublicKey(data.subarray(8+i*32,40+i*32)).equals(key), `Existing Stolons config field ${i} differs`));
  [60n,60n,3600n,86400n,100_000n].forEach((value,i)=>must(data.readBigUInt64LE(264+i*8)===value, `Existing Stolons timing/fee field ${i} differs`));
  must(instructions.length===0, 'Config exists but platform is missing');
  console.log('Stolons is already initialized with the expected Devnet configuration.');
  process.exit(0);
}
instructions.push(init);
const profile={cluster:'devnet',wallet:walletText,program:programText,launchpad:launchpad.toBase58(),cpmm:cpmm.toBase58(),launchConfig:launchConfig.toBase58(),cpmmConfig:cpConfig.toBase58(),platform:platform.toBase58(),config:config.toBase58(),reproductionAuthority:reproduction.toBase58(),quoteMint:quote.toBase58(),proposalWindowSeconds:60,votingWindowSeconds:60,proposalFeeLamports:100000,platformTradeFee:0,creatorTradeFee:0};
console.log(JSON.stringify(profile,null,2));
const latest=await connection.getLatestBlockhash('confirmed');
const transaction=new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:latest.blockhash,instructions}).compileToLegacyMessage());
must(transaction.serialize().length<=1232,'Combined setup transaction exceeds packet size');
const simulation=await connection.simulateTransaction(transaction,{sigVerify:false,commitment:'confirmed'});
console.log((simulation.value.logs??[]).join('\n'));
must(!simulation.value.err, `Setup simulation failed: ${JSON.stringify(simulation.value.err)}`);
console.log('Setup simulation passed.');
if(mode!=='--apply') { console.log('No transaction sent. Run bash scripts/devnet/configure.sh --apply to initialize.'); process.exit(0); }
const idl = JSON.parse(await readFile(new URL('target/idl/stolons.json', root), 'utf8'));
must(idl.address === programText, 'IDL/program identity mismatch');
const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(new URL('keypairs/devnet-wallet.json',root),'utf8'))));
must(signer.publicKey.equals(wallet),'Wallet key mismatch');
transaction.sign([signer]);
const signature=await connection.sendRawTransaction(transaction.serialize(),{preflightCommitment:'confirmed'});
const confirmation=await connection.confirmTransaction({signature,...latest},'confirmed');
must(!confirmation.value.err,`Setup transaction failed: ${JSON.stringify(confirmation.value.err)}`);
await mkdir(new URL('target/devnet/',root),{recursive:true});
await writeFile(new URL('target/devnet/configuration.json',root),JSON.stringify({...profile,signature},null,2)+'\n');
console.log(`Initialized Stolons on Devnet: ${signature}`);
