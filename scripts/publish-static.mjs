import {ROOT} from './lib.mjs';
import {publishSnapshotBundle} from './snapshot-bundle.mjs';
console.log(JSON.stringify(await publishSnapshotBundle(ROOT)));
