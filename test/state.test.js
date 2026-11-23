import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadState, pruneRuns, saveState, StateLock } from '../lib/state.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-mail-remote-'))
}

test('save/load round-trips state and leaves no tmp file', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'nested', 'state.json')
    const state = loadState(file)
    assert.equal(state.lastUid, 0)
    state.lastUid = 42
    state.done['<m1@x>'] = { at: 1, sessionId: 'session-1' }
    saveState(file, state)
    const again = loadState(file)
    assert.equal(again.lastUid, 42)
    assert.equal(again.done['<m1@x>'].sessionId, 'session-1')
    assert.ok(again.updatedAt > 0)
    assert.equal(existsSync(`${file}.${process.pid}.tmp`), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt state file is refused instead of silently overwritten', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'state.json')
    writeFileSync(file, '{not json')
    assert.throws(() => loadState(file), /状态文件损坏/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('lock is single-writer and releases', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'state.json')
    const first = new StateLock(file)
    const second = new StateLock(file)
    assert.equal(first.acquire(), true)
    assert.equal(second.acquire(), false)
    first.release()
    assert.equal(second.acquire(), true)
    second.release()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('lock steals from a dead pid once it is stale', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'state.json')
    const lockFile = `${file}.lock`
    writeFileSync(lockFile, JSON.stringify({ pid: 999999, at: 0 }))
    const old = new Date(Date.now() - 60 * 60 * 1000)
    utimesSync(lockFile, old, old)
    const lock = new StateLock(file)
    assert.equal(lock.acquire(), true)
    lock.release()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pruneRuns drops timestamps outside the window', () => {
  const now = Date.now()
  const state = { runs: [now - 1000, now - 7200_000, 'bad'] }
  pruneRuns(state, now, 3600_000)
  assert.deepEqual(state.runs, [now - 1000])
})
