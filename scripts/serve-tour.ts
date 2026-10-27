import path from 'node:path';
import {createShowroomApp} from '../server/showroom.ts';
const artifact=process.argv[2];
if(!artifact)throw Error('Usage: npm run tour:serve -- /export-directory');
const port=Number(process.env.PORT??4190),origin=`http://127.0.0.1:${port}`;
createShowroomApp(path.resolve(artifact),origin).listen(port,'127.0.0.1',()=>console.log(`Isolated showroom: ${origin}`));
