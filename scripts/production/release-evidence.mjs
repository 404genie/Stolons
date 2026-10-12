// Offline artifact provenance checks; never establishes deployment approval.
export function verifyReleaseEvidence(report, auditedBuild, clockEvidence, runtimeEvidence=null) {
 for (const field of ['sourceCommit','programId','artifactBytes']) {
  if (report[field]!==auditedBuild[field]) throw Error(`Release differs from reviewed build: ${field}`);
 }
 for (const field of ['program','idl']) {
  if (report.sha256[field]!==auditedBuild.sha256[field]) throw Error(`Release differs from reviewed build: ${field} SHA-256`);
 }
 const clockPassed=clockEvidence.status==='passed'&&clockEvidence.cluster==='devnet'&&clockEvidence.poolStatusAfterSimulatedBuy===1&&BigInt(clockEvidence.vestingStartTime)>0n&&clockEvidence.vestingStartTime===clockEvidence.clockUnixTimestamp&&clockEvidence.completingBuySubmitted===false;
 if (!clockPassed) throw Error('Reviewed pre-migration devnet timestamp evidence is invalid.');
 const required=['on-time pending migration','on-time migrated','late pending migration','unfinished curve','wrong fundraising target','loser refund','successful winner refund','expired winner forfeiture','orphan winner forfeiture','active winner stays locked','redirected proposer rejected'];
 const runtimePassed=runtimeEvidence?.status==='passed'&&runtimeEvidence.binarySha256===report.sha256.program&&runtimeEvidence.programId===report.programId&&runtimeEvidence.mainnetTransactionsSent===0&&required.every(label=>runtimeEvidence.cases?.some(c=>c.label===label&&c.status==='passed'));
 return {
  artifactMatchesReviewedBuild:true,
  devnetPreMigrationTimestampVerified:true,
  mainnetTimestampVerified:false,
  stolonsExpiryAndBondRuntimeVerified:runtimePassed,
  deploymentVerified:false,
  publicLaunchApproved:false,
  remainingGates:['Verify mainnet LaunchLab timestamp behavior or reviewed binary/source equivalence',...(!runtimePassed?['Exercise Stolons expiry and bond instructions with adversarial account fixtures']:[]),'Preserve Rust dependency lockfile and build toolchain provenance','Complete production configuration and deployment verification']
 };
}
