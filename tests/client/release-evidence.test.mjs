import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyReleaseEvidence} from '../../scripts/production/release-evidence.mjs';
const build={sourceCommit:'a'.repeat(40),programId:'reviewed-program',artifactBytes:796968,sha256:{program:'b'.repeat(64),idl:'c'.repeat(64)}};
const clock={status:'passed',cluster:'devnet',poolStatusAfterSimulatedBuy:1,vestingStartTime:'1791763602',clockUnixTimestamp:'1791763602',completingBuySubmitted:false};
test('offline review binds both artifacts and provenance without approving release',()=>{
 const result=verifyReleaseEvidence(structuredClone(build),build,clock);
 assert.equal(result.artifactMatchesReviewedBuild,true);
 assert.equal(result.devnetPreMigrationTimestampVerified,true);
 assert.equal(result.mainnetTimestampVerified,false);
 assert.equal(result.publicLaunchApproved,false);
 for(const mutate of [r=>r.sourceCommit='d'.repeat(40),r=>r.programId='wrong',r=>r.artifactBytes++,r=>r.sha256.program='e'.repeat(64),r=>r.sha256.idl='f'.repeat(64)]){
  const report=structuredClone(build);mutate(report);assert.throws(()=>verifyReleaseEvidence(report,build,clock));
 }
});
test('final pool states or mismatched clocks cannot substitute for intermediate evidence',()=>{
 for(const patch of [{status:'failed'},{cluster:'mainnet-beta'},{poolStatusAfterSimulatedBuy:2},{vestingStartTime:'0'},{clockUnixTimestamp:'1791763603'},{completingBuySubmitted:true}])assert.throws(()=>verifyReleaseEvidence(build,build,{...clock,...patch}));
});
test('runtime gate requires matching reviewed binary and every successful case',async()=>{
 const {readFile}=await import('node:fs/promises');
 const runtime=JSON.parse(await readFile(new URL('../../docs/validation/expiry-bond-runtime-2026-10-12.json',import.meta.url)));
 const reviewed=JSON.parse(await readFile(new URL('../../docs/validation/mainnet-audit-build-2026-10-11.json',import.meta.url)));
 assert.equal(verifyReleaseEvidence(reviewed,reviewed,clock,runtime).stolonsExpiryAndBondRuntimeVerified,true);
 for(const patch of [{binarySha256:'wrong'},{programId:'wrong'},{cases:runtime.cases.slice(1)},{mainnetTransactionsSent:1}])assert.equal(verifyReleaseEvidence(reviewed,reviewed,clock,{...runtime,...patch}).stolonsExpiryAndBondRuntimeVerified,false);
});
