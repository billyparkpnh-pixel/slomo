import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const randomToken=()=>randomBytes(32).toString('hex');
export const hashToken=value=>createHash('sha256').update(value).digest('hex');
export function hashPassword(password) {
  const salt=randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function verifyPassword(password,encoded) {
  const [salt,key]=encoded.split(':');
  const actual=scryptSync(password,salt,64);
  const expected=Buffer.from(key,'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function initializeAdmin(db,directory,password,production) {
  if(password && password.length<12) throw new Error('ADMIN_PASSWORD must have at least 12 characters.');
  if(password) {
    const admin=db.prepare('SELECT password_hash FROM admins WHERE username=?').get('admin');
    if(!admin || !verifyPassword(password,admin.password_hash)) {
      db.prepare('INSERT INTO admins(username,password_hash) VALUES (?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash').run('admin',hashPassword(password));
      db.exec('DELETE FROM sessions');
    }
  } else if(!db.prepare('SELECT 1 FROM admins').get()) {
    if(production) throw new Error('Set ADMIN_PASSWORD before starting production.');
    const path=join(directory,'local-admin-password.txt');
    const generated=existsSync(path)?readFileSync(path,'utf8').trim():randomToken().slice(0,24);
    writeFileSync(path,generated+'\n',{mode:0o600});
    db.prepare('INSERT INTO admins(username,password_hash) VALUES (?,?)').run('admin',hashPassword(generated));
    console.log(`Local admin credentials: username admin; password saved in ${path}.`);
  }
}

export function rateLimit(db,key,maximum,windowMs) {
  const now=Date.now();
  db.prepare('DELETE FROM rate_limits WHERE key=? AND expires<=?').run(key,now);
  db.prepare('INSERT INTO rate_limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+windowMs);
  return db.prepare('SELECT count FROM rate_limits WHERE key=?').get(key).count<=maximum;
}
