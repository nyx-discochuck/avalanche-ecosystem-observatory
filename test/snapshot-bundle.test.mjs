import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishSnapshotBundle, readPublishedSnapshot } from '../scripts/snapshot-bundle.mjs';
const bundle = (id) => Object.fromEntries(['dashboard.json','blockspace.json','tokenized-activity.json'].map(name=>[name,{schema:name,generatedAt:id,tokenizedAssets:{activityStatus:{generatedAt:id}}}]));
test('failed pre-switch publication keeps whole old bundle; post-switch failure exposes whole new bundle',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'token-bundle-'));
 try {
  await publishSnapshotBundle(root,bundle('old'));
  await assert.rejects(publishSnapshotBundle(root,bundle('new'),{beforeSwitch:()=>{throw Error('kill-before')}}));
  for(const name of Object.keys(bundle('old')))assert.equal((await readPublishedSnapshot(root,name)).generatedAt,'old');
  await assert.rejects(publishSnapshotBundle(root,bundle('new'),{afterSwitch:()=>{throw Error('kill-after')}}));
  for(const name of Object.keys(bundle('new')))assert.equal((await readPublishedSnapshot(root,name)).generatedAt,'new');
  const pointer=JSON.parse(await fs.readFile(path.join(root,'state/published/current.json'),'utf8'));
  await fs.writeFile(path.join(root,'state/published/releases',pointer.id,'dashboard.json'),'{}');
  await assert.rejects(readPublishedSnapshot(root,'dashboard.json',()=>bundle('old')['dashboard.json']),/digest/);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
