import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_STATE = {
  version: 1,
  uidValidity: null,
  lastUid: 0,
  done: {},
  threads: {},
  runs: [],
  inflight: {},
  updatedAt: 0,
}

/** Load one state file, filling in any field a previous version did not write. */
export function loadState(file) {
  if (!existsSync(file)) return structuredClone(DEFAULT_STATE)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`dsh-mail-remote: 状态文件损坏，拒绝覆盖（${file}）：${error.message}`)
  }
  return {
    ...structuredClone(DEFAULT_STATE),
    ...parsed,
    done: parsed.done ?? {},
    threads: parsed.threads ?? {},
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    inflight: parsed.inflight ?? {},
  }
}

/** Atomically replace one state file (tmp + fsync + rename). */
export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  state.updatedAt = Date.now()
  const tmp = `${file}.${process.pid}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, JSON.stringify(state, null, 2))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file)
}

/**
 * Single-writer lock living beside the state file. A crashed holder is stolen
 * after `staleMs`, so a kill -9 cannot wedge the channel forever.
 */
export class StateLock {
  constructor(file, { staleMs = 10 * 60 * 1000 } = {}) {
    this.file = `${file}.lock`
    this.staleMs = staleMs
    this.held = false
  }

  acquire() {
    mkdirSync(dirname(this.file), { recursive: true })
    try {
      const fd = openSync(this.file, 'wx')
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
      } finally {
        closeSync(fd)
      }
      this.held = true
      return true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    // Someone holds it. Steal only when the holder is clearly gone or too old.
    let holder = null
    try {
      holder = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      /* unreadable lock: fall through to age check */
    }
    const age = Date.now() - statSync(this.file).mtimeMs
    const alive = holder !== null && Number.isInteger(holder.pid) && pidAlive(holder.pid)
    if (alive && age < this.staleMs) return false
    try {
      unlinkSync(this.file)
    } catch {
      return false
    }
    return this.acquire()
  }

  release() {
    if (!this.held) return
    this.held = false
    try {
      unlinkSync(this.file)
    } catch {
      /* already gone */
    }
  }
}

function pidAlive(pid) {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** Drop rate-limit timestamps outside the rolling window. */
export function pruneRuns(state, now, windowMs) {
  state.runs = state.runs.filter((at) => typeof at === 'number' && now - at < windowMs)
  return state.runs
}

export function statePathFor(config) {
  return config.stateFile
}

export { DEFAULT_STATE }
