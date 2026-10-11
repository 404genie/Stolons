import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSolUsd,usdMarketValues} from '../../apps/web/lib/usd-price.ts';
const id='a'.repeat(64);
const update=price=>({parsed:[{id,price:{price:'15000000000',expo:-8,publish_time:1000,conf:'1000000',...price}}]});
test('mainnet market statistics convert SOL values with a validated fresh USD quote',()=>{
 const price=parseSolUsd(update({}),id,1001);assert.equal(price.value,150);
 assert.deepEqual(usdMarketValues({marketCapSol:20,liquiditySol:2},0.5,price.value),{marketCapUsd:3000,liquidityUsd:300,volume1hUsd:75});
});
test('missing pricing or history stays unavailable rather than showing zero dollars',()=>{
 assert.deepEqual(usdMarketValues({marketCapSol:20,liquiditySol:2},0.5,null),{marketCapUsd:null,liquidityUsd:null,volume1hUsd:null});
 assert.equal(usdMarketValues({marketCapSol:20,liquiditySol:2},null,150).volume1hUsd,null);
 assert.equal(usdMarketValues({marketCapSol:20,liquiditySol:2},0,150).volume1hUsd,0);
});
test('stale, future, unrelated, uncertain, and invalid prices are rejected',()=>{
 for(const price of [{publish_time:800},{publish_time:1020},{price:'0'},{conf:'1000000000'},{expo:NaN}])assert.throws(()=>parseSolUsd(update(price),id,1001));
 assert.throws(()=>parseSolUsd(update({}),'b'.repeat(64),1001));
});
