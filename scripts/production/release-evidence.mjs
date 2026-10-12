// Offline artifact provenance checks; never establishes deployment approval.
export function verifyReleaseEvidence(report, auditedBuild, clockEvidence) {
 for (const field of ['sourceCommit','programId','artifactBytes']) {
  if (report[field]!==auditedBuild[field]) throw Error(`Release differs from reviewed build: ${field}`);
 }
 for (const field of ['program','idl']) {
  if (report.sha256[field]!==auditedBuild.sha256[field]) throw Error(`Release differs from reviewed build: ${field} SHA-256`);
 }
 const clockPassed=clockEvidence.status==='passed'&&clockEvidence.cluster==='devnet'&&clockEvidence.poolStatusAfterSimulatedBuy===1&&BigInt(clockEvidence.vestingStartTime)>0n&&clockEvidence.vestingStartTime===clockEvidence.clockUnixTimestamp&&clockEvidence.completingBuySubmitted===false;
 if (!clockPassed) throw Error('Reviewed pre-migration devnet timestamp evidence is invalid.');
 return {
  artifactMatchesReviewedBuild:true,
  devnetPreMigrationTimestampVerified:true,
  mainnetTimestampVerified:false,
  stolonsExpiryAndBondRuntimeVerified:false,
  deploymentVerified:false,
  publicLaunchApproved:false,
  remainingGates:['Verify mainnet LaunchLab timestamp behavior or reviewed binary/source equivalence','Exercise Stolons expiry and bond instructions with adversarial account fixtures','Preserve Rust dependency lockfile and build toolchain provenance','Complete production configuration and deployment verification']
 };
}
