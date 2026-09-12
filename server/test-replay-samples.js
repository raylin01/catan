import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/create-replay-samples.js', import.meta.url));

test('sample CLI requires an explicit new database and preserves existing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catan-sample-cli-'));
  try {
    const run = args => spawnSync(process.execPath, [script, ...args], {cwd: dir, encoding: 'utf8'});
    const missing = run([]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /--db PATH is required/);
    assert.deepEqual(readdirSync(dir), []);
    const path = join(dir, 'existing.sqlite');
    writeFileSync(path, 'Existing game data must remain unchanged.');
    const refused = run(['--db', path]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refusing to use existing database/);
    assert.equal(readFileSync(path, 'utf8'), 'Existing game data must remain unchanged.');
    const invalid = run(['--db', join(dir, 'new.sqlite'), '--max-turns', '0']);
    assert.equal(invalid.status, 1);
    assert.deepEqual(readdirSync(dir), ['existing.sqlite']);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
