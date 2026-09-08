import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RoomStore} from './store.js';

test('room snapshots and action receipts survive database reopen together',()=>{
  const dir=mkdtempSync(join(tmpdir(),'catan-store-'));
  try {
    const path=join(dir,'rooms.sqlite');let store=new RoomStore(path);
    const room={code:'ABCDEF',revision:3,game:{phase:'setup'},receipts:{request1:{success:true}}};
    store.save(room);store.close();store=new RoomStore(path);
    assert.deepEqual(store.load(),[room]);
    room.revision++;store.save(room);assert.equal(store.load().length,1);store.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
