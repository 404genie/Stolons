import test from 'node:test';
import assert from 'node:assert/strict';
import {launchInstructions,timestampComparison} from '../../scripts/devnet/trace-graduation-clock.mjs';
test('clock trace only classifies instructions inside the verified launch program',()=>{
 const logs=['Program proxy invoke [1]','Program other invoke [2]','Program log: Instruction: BuyExactIn','Program other success','Program launch invoke [2]','Program log: Instruction: BuyExactOut','Program launch success','Program proxy success'];
 assert.deepEqual(launchInstructions(logs,'launch'),['buy']);assert.deepEqual(launchInstructions(logs,'unrelated'),[]);
 assert.deepEqual(launchInstructions(['Program launch invoke [1]','Program log: Instruction: MigrateToCpswap','Program launch success'],'launch'),['migration']);
});
test('clock comparison distinguishes final timestamps without claiming historical status-1 proof',()=>{
 const buy={blockTime:100},migration={blockTime:110};
 assert.equal(timestampComparison(110,buy,migration),'final-stored-timestamp-matches-migration');
 assert.equal(timestampComparison(100,buy,migration),'final-stored-timestamp-matches-final-buy');
 assert.equal(timestampComparison(100,buy,{blockTime:100}),'inconclusive-same-second');
 assert.equal(timestampComparison(100,null,migration),'inconclusive-history');
});
