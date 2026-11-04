import { fieldFromSourceEnvelope, summarizeTokenized } from './tokenized-dashboard.mjs';
import { fetchJson } from './lib.mjs';

const MAX_SUPPLY_AGE=86400;
export function updateDashboardTokenized(dashboard, snapshot, { now=Date.now(), error='Canonical Gateway unavailable' }={}) {
  const next=structuredClone(dashboard);
  const t=next.tokenizedAssets;
  if(!t?.assets?.length)throw new Error('Tokenized baseline missing');
  const valid=snapshot?.schemaVersion==='avalanche-gateway-tokenized-assets/v2'&&snapshot.registryVersion==='avalanche-tokenized-assets-registry/2026-09-18'&&snapshot.chainId===43114&&snapshot.assets?.length===4&&new Set(snapshot.assets.map(r=>r.id)).size===4&&t.assets.every(a=>snapshot.assets.some(r=>r.id===a.id&&r.address?.toLowerCase()===a.address.toLowerCase()));
  const canonical=valid?snapshot:null;
  const byId=new Map((canonical?.assets||[]).map(a=>[a.id,a]));
  const staleSnapshot=!canonical||canonical.freshness?.stale||now-Date.parse(canonical.generatedAt)>900000;
  for(const a of t.assets){
    a.fieldStatus ||= {};
    const r=byId.get(a.id);
    const maxPriceAge=a.id==='secz'?259200:172800;
    const mappings={totalSupply:r?.token?.totalSupply,symbol:r?.token?.symbol,tokenName:r?.token?.tokenName,valuationUsd:r?.valuation,valueUsd:r?.valueUsd};
    for(const [key,envelope]of Object.entries(mappings)){
      const previous=a.fieldStatus?.[key];
      const limit=key==='valuationUsd'?maxPriceAge:key==='valueUsd'?maxPriceAge:MAX_SUPPLY_AGE;
      const sourceTime=envelope?.observedAt||previous?.observedAt;
      const expired=!Number.isFinite(Date.parse(sourceTime))||now-Date.parse(sourceTime)>limit*1000;
      const e=expired?{value:null,availability:'unavailable',observedAt:sourceTime,expired:true,error:'Observation expired or source time unavailable'}:envelope;
      const field=fieldFromSourceEnvelope(e,{previousValue:a[key],previousStatus:previous,sourceError:error});
      if(staleSnapshot&&field.value!=null)field.status={...field.status,availability:'stale',retainedLastGood:true,error:'Canonical refresh is stale or unavailable'};
      a[key]=field.value;a.fieldStatus[key]=field.status;
    }
    // A derived value cannot outlive either input, even if its feed timestamp
    // itself remains within the slower NAV publication cadence.
    if(a.totalSupply==null||a.valuationUsd==null){a.valueUsd=null;a.fieldStatus.valueUsd={...a.fieldStatus.valueUsd,availability:'unavailable',error:'Valuation input unavailable'};}
    if(r){
      Object.assign(a,{decimals:r.token?.decimals?.value??null,totalSupplyRaw:r.token?.totalSupplyRaw?.value??null,totalSupplyExact:r.token?.totalSupplyExact?.value??null,valueUsdExact:a.valueUsd==null?null:r.valueUsd?.valueExact??null,valuationUsdExact:r.valuation?.valueExact??null,valuationAnswerRaw:r.valuation?.answerRaw??r.valuation?.feed?.answerRaw??null,valuationFeed:r.valuation?.feed??null,valuationBasis:r.valuationBasis,valuationSource:r.valuationSource,feedContract:r.feedContract,supplyBlock:r.supplyBlock,gatewayBlock:canonical.block,gatewayStatus:staleSnapshot?'stale':r.status,issuer:r.issuer,issuerUrl:r.issuerUrl,productUrl:r.productUrl,supplementalFeeds:r.supplementalFeeds||[],tokenStatus:r.token,valueStatus:r.valueUsd});
    }
    a.supplyObservedAt=a.fieldStatus.totalSupply.observedAt;a.valuationObservedAt=a.fieldStatus.valuationUsd.observedAt;a.valueObservedAt=a.fieldStatus.valueUsd.observedAt;
    const holderAge=now-Date.parse(a.fieldStatus.holders?.observedAt);
    if(!Number.isFinite(holderAge)||holderAge>172800000){a.holders=null;a.fieldStatus.holders={...a.fieldStatus.holders,availability:'unavailable',error:'Holder observation expired or unverified'};}
  }
  t.kpis=summarizeTokenized(t.assets,t.kpis.rwaAdapterTvlUsd);
  t.updatedAt=new Date(now).toISOString();
  if(!staleSnapshot && t.kpis.valueAvailability==='available' && Number.isFinite(t.kpis.verifiedContractValueUsd)){
    const observedAt=canonical.block.timestamp;
    const point={date:observedAt.slice(0,10),observedAt,total:t.kpis.verifiedContractValueUsd,source:'canonical-observation',assets:Object.fromEntries(t.assets.map(a=>[a.id,{valueUsd:a.valueUsd,supplyObservedAt:a.supplyObservedAt,valuationObservedAt:a.valuationObservedAt}]))};
    t.valueHistory=[...(t.valueHistorySource==='canonical-observations' ? t.valueHistory||[] : []).filter(p=>p.date!==point.date),point].sort((a,b)=>a.date.localeCompare(b.date)).slice(-730);
    t.valueHistorySource='canonical-observations';
  }
  if(next.quality?.sourceHealth){
    const health={id:'avalanche-gateway-tokenized-assets',ok:!staleSnapshot&&t.kpis.valueAvailability==='available',fetchedAt:canonical?.generatedAt||null,error:!staleSnapshot&&t.kpis.valueAvailability==='available'?null:error};
    next.quality.sourceHealth=[...next.quality.sourceHealth.filter(s=>s.id!==health.id),health];
    if(next.metadata)next.metadata.freshness=next.quality.sourceHealth.every(s=>s.ok)?'healthy':'degraded';
  }
  if(canonical)t.canonicalSnapshot={source:'avalanche_gateway',schemaVersion:canonical.schemaVersion,registryVersion:canonical.registryVersion,generatedAt:canonical.generatedAt,block:canonical.block,coverage:canonical.coverage,freshness:canonical.freshness,availability:staleSnapshot?'stale':canonical.coverage?.availability};
  else t.canonicalSnapshot={...t.canonicalSnapshot,availability:'stale',error};
  next.overview.kpis.tokenizedAssetValueUsd=t.kpis.verifiedContractValueUsd;
  return next;
}

export async function refreshDashboardTokenized(dashboard){
 const result=await fetchJson(process.env.TOKENIZED_GATEWAY_URL||'http://127.0.0.1:43140/api/materialized/avalanche/tokenized-assets',{timeoutMs:10000,retries:0});
 return updateDashboardTokenized(dashboard,result.ok?result.data:null,{error:result.error});
}
