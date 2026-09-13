import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';

/** A room snapshot and its idempotency receipts commit together. */
export class RoomStore {
  constructor(path) {
    this.durableRecordingJournal=true;
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);
    if(path!==':memory:') chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recording_events (
        recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY(recording_id,seq)
      );
      CREATE TABLE IF NOT EXISTS recording_checkpoints (
        recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY(recording_id,seq)
      );
      CREATE INDEX IF NOT EXISTS recordings_updated ON recordings(updated_at DESC,id);
      CREATE INDEX IF NOT EXISTS recording_events_after ON recording_events(recording_id,seq);`);
  }
  load() {
    return this.db.prepare(`SELECT version,data FROM rooms
      WHERE NOT EXISTS (
        SELECT 1 FROM recordings WHERE recordings.room_code=rooms.code AND recordings.status IN ('won','ended','closed')
      )`).all().map(row=>{
      if(row.version!==1) throw Error('Unsupported saved-room version');
      return JSON.parse(row.data);
    });
  }
  hasRoom(code){return !!this.db.prepare('SELECT 1 FROM rooms WHERE code=?').get(code);}
  loadRoom(code) {
    const row=this.db.prepare('SELECT version,data FROM rooms WHERE code=?').get(code);
    if(!row)return null;
    if(row.version!==1)throw Error('Unsupported saved-room version');
    return JSON.parse(row.data);
  }
  save(room,mutation=null) {
    const roomData=JSON.stringify(room);
    const recording=mutation?.recording;
    const recordingData=recording?JSON.stringify({...recording,events:undefined,checkpoints:undefined}):null;
    const eventData=mutation?.event?JSON.stringify(mutation.event):null;
    const checkpointData=mutation?.checkpoint?JSON.stringify(mutation.checkpoint.state):null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO rooms(code,version,data) VALUES (?,1,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data,version=1').run(room.code,roomData);
      if(recording) {
        this.db.prepare(`INSERT INTO recordings(id,room_code,version,status,created_at,updated_at,data)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          room_code=excluded.room_code,version=excluded.version,status=excluded.status,updated_at=excluded.updated_at,data=excluded.data`)
          .run(recording.id,recording.roomCode,recording.formatVersion,recording.status,recording.createdAt,recording.lastAt,recordingData);
        if(eventData)this.db.prepare('INSERT INTO recording_events(recording_id,seq,data) VALUES (?,?,?)').run(recording.id,mutation.event.seq,eventData);
        if(checkpointData)this.db.prepare('INSERT INTO recording_checkpoints(recording_id,seq,data) VALUES (?,?,?)').run(recording.id,mutation.checkpoint.seq,checkpointData);
      }
      this.db.exec('COMMIT');
    } catch(error) {
      try {this.db.exec('ROLLBACK');} catch {}
      throw error;
    }
  }
  getRecording(id) {
    const row=this.db.prepare('SELECT data FROM recordings WHERE id=?').get(id);
    return row?JSON.parse(row.data):null;
  }
  getRecordingEvents(id,{after=0,limit=null}={}) {
    const boundedAfter=Number.isSafeInteger(after)&&after>=0?after:0;
    const rows=limit==null
      ?this.db.prepare('SELECT data FROM recording_events WHERE recording_id=? AND seq>? ORDER BY seq').all(id,boundedAfter)
      :this.db.prepare('SELECT data FROM recording_events WHERE recording_id=? AND seq>? ORDER BY seq LIMIT ?').all(id,boundedAfter,limit);
    return rows.map(row=>JSON.parse(row.data));
  }
  getRecordingCheckpoint(id,at) {
    const row=this.db.prepare('SELECT seq,data FROM recording_checkpoints WHERE recording_id=? AND seq<=? ORDER BY seq DESC LIMIT 1').get(id,at);
    return row?{seq:row.seq,state:JSON.parse(row.data)}:null;
  }
  listRecordings({limit=50,offset=0}={}) {
    return this.db.prepare('SELECT data FROM recordings ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(limit,offset).map(row=>JSON.parse(row.data));
  }
  countRecordings(){return Number(this.db.prepare('SELECT COUNT(*) AS count FROM recordings').get().count);}
  deleteRecording(id) {
    const recording=this.getRecording(id);
    if(!recording)return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM recordings WHERE id=?').run(id);
      this.db.prepare('DELETE FROM rooms WHERE code=?').run(recording.roomCode);
      this.db.exec('COMMIT');return true;
    } catch(error) {
      try {this.db.exec('ROLLBACK');} catch {}
      throw error;
    }
  }
  close(){this.db.close();}
}
