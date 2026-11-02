import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { openDatabase } from '../server/db.js';
import { initializeAdmin } from '../server/auth.js';
if(existsSync('.env')) process.loadEnvFile('.env');
if(!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length<12) {
  console.error('Set ADMIN_PASSWORD (12+ characters) in your environment or .env, then run npm run admin:password.');
  process.exit(1);
}
const directory=resolve(process.env.DATA_DIR??'data');
const db=openDatabase(directory);
initializeAdmin(db,directory,process.env.ADMIN_PASSWORD,false);
db.exec('DELETE FROM sessions'); db.close();
console.log('Admin password updated. All sessions revoked.');
