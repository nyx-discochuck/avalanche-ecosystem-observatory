import test from 'node:test';
import assert from 'node:assert/strict';
import {updateDashboardTokenized} from '../scripts/tokenized-publisher.mjs';
const now=Date.parse('2026-09-18T12:00:00Z');
function fixture(){
 const ids=['buidl','vbill','acred','secz']; const observedAt='2026-09-18T11:55:00Z';
 const field=value=>({value,observedAt,availability:'available'});
 const assets=ids.map((id,i)=>({id,address:'0x'+String(i+1).padStart(40,'0'),valueUsd:10,totalSupply:10,valuationUsd:1,holders:2,fieldStatus:Object.fromEntries(['valueUsd','totalSupply','valuationUsd','holders','symbol','tokenName'].map(k=>[k,{observedAt,availability:'available'}])),history:[]}));
 const dashboard={generatedAt:'old',blockspace:{unchanged:true},lending:{unchanged:true},spot:{unchanged:true},overview:{kpis:{tokenizedAssetValueUsd:40},other:'unchanged'},tokenizedAssets:{kpis:{rwaAdapterTvlUsd:20},assets}};
 const snapshot={schemaVersion:'avalanche-gateway-tokenized-assets/v2',registryVersion:'avalanche-tokenized-assets-registry/2026-09-18',chainId:43114,generatedAt:observedAt,block:{timestamp:observedAt},assets:assets.map(a=>({...a,valueUsd:field(10),valuation:field(1),token:{totalSupply:field(10),symbol:field(a.id),tokenName:field(a.id)}}))};
 return{dashboard,snapshot};
}
test('tokenized-only refresh preserves unrelated sections and clocks, and expired canonical values never fall back',()=>{
 const {dashboard,snapshot}=fixture(); snapshot.assets[0].valueUsd={value:null,availability:'unavailable',expired:true,observedAt:'2026-09-14T12:00:00Z'};
 const d=updateDashboardTokenized(dashboard,snapshot,{now});
 for(const key of ['generatedAt','blockspace','lending','spot'])assert.deepEqual(d[key],dashboard[key]);
 assert.equal(d.tokenizedAssets.assets[0].valueUsd,null);
 assert.equal(d.tokenizedAssets.kpis.verifiedContractValueUsd,null);
 assert.equal(d.tokenizedAssets.kpis.partialObservedValueUsd,30);
 assert.equal(d.tokenizedAssets.kpis.valueCoverage,'3/4');
});
test('transport outage retains original input clocks as stale, then hard-expires aggregate',()=>{
 const {dashboard}=fixture(); const stale=updateDashboardTokenized(dashboard,null,{now});
 assert.equal(stale.tokenizedAssets.kpis.valueAvailability,'stale');
 assert.equal(stale.tokenizedAssets.assets[0].fieldStatus.valueUsd.observedAt,'2026-09-18T11:55:00Z');
 const expired=updateDashboardTokenized(dashboard,null,{now:now+86400001});
 assert.equal(expired.tokenizedAssets.assets[0].totalSupply,null);
 assert.equal(expired.tokenizedAssets.kpis.verifiedContractValueUsd,null);
});
