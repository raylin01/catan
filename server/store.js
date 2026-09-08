import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';

/** A room snapshot and its idempotency receipts commit together. */
export class RoomStore {
  constructor(path) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);
    if(path!==':memory:') chmodSync(path,0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL)');
  }
  load() {
    return this.db.prepare('SELECT version,data FROM rooms').all().map(row=>{
      if(row.version!==1) throw Error('Unsupported saved-room version');
      return JSON.parse(row.data);
    });
  }
  save(room) {
    this.db.prepare('INSERT INTO rooms(code,version,data) VALUES (?,1,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data,version=1').run(room.code,JSON.stringify(room));
  }
  close(){this.db.close();}
}
