#!/usr/bin/env node
// Exercises apply() with a fake Cordis context: no DSH needed.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { apply } from '../lib/index.js'

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, 'config.local.json'), 'utf8'))
raw.dryRun = true
raw.stateFile = resolve(import.meta.dirname, 'state.smoke.json')
raw.workdir = resolve(import.meta.dirname, 'workdir')
raw.pollSeconds = 10
raw.skipExisting = false

const disposers = []
const ctx = {
  logger: {
    info: (m) => console.log('[info]', m),
    warn: (m) => console.log('[warn]', m),
    error: (m) => console.log('[error]', m),
  },
  effect: (fn) => {
    const dispose = fn()
    disposers.push(dispose)
    return dispose
  },
  get: () => undefined,
  on: () => () => {},
}

apply(ctx, raw)
console.log('apply() returned; waiting for the first poll (3s)...')
setTimeout(() => {
  for (const dispose of disposers) dispose?.()
  console.log('smoke done')
  process.exit(0)
}, 8000)
