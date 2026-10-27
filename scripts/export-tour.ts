import path from 'node:path';
import {exportPublication} from '../server/export.ts';
const [id,target]=process.argv.slice(2);
if(!id||!target)throw Error('Usage: npm run tour:export -- APPROVED_PUBLIC_ID /new/private/export-directory');
console.log(exportPublication(path.resolve(process.env.DATA_DIR??'.data'),id,path.resolve(target),path.resolve('dist')));
