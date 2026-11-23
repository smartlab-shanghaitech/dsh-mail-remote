import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateMessage } from '../lib/gate.js'

const CONFIG = {
  allowFrom: ['alice@example.com'],
  subjectToken: '[DSH-7f3a]',
  maxPerHour: 2,
}

function mail(overrides = {}) {
  return {
    messageId: '<m1@example.com>',
    fromAddress: 'alice@example.com',
    subject: '[DSH-7f3a] 请执行',
    body: '跑一下测试',
    headers: {},
    ...overrides,
  }
}

function state(overrides = {}) {
  return { done: {}, runs: [], ...overrides }
}

test('accepts a well-formed command mail', () => {
  assert.deepEqual(evaluateMessage(mail(), CONFIG, state()), { accept: true, code: 'accept' })
})

test('rejects a sender outside the exact allowlist', () => {
  assert.equal(evaluateMessage(mail({ fromAddress: 'alice@example.com.evil.com' }), CONFIG, state()).code, 'from-not-allowed')
  assert.equal(evaluateMessage(mail({ fromAddress: 'bob@example.com' }), CONFIG, state()).code, 'from-not-allowed')
})

test('rejects a subject without the token', () => {
  assert.equal(evaluateMessage(mail({ subject: '请执行' }), CONFIG, state()).code, 'missing-token')
})

test('rejects our own auto reply', () => {
  assert.equal(evaluateMessage(mail({ headers: { 'x-dsh-auto-reply': '1' } }), CONFIG, state()).code, 'self-reply')
})

test('rejects auto-submitted and bulk mail', () => {
  assert.equal(evaluateMessage(mail({ headers: { 'auto-submitted': 'auto-replied' } }), CONFIG, state()).code, 'auto-submitted')
  assert.equal(evaluateMessage(mail({ headers: { precedence: 'bulk' } }), CONFIG, state()).code, 'bulk')
})

test('rejects duplicates by Message-ID', () => {
  assert.equal(evaluateMessage(mail(), CONFIG, state({ done: { '<m1@example.com>': { at: 1 } } })).code, 'duplicate')
})

test('rejects empty body after cleaning', () => {
  assert.equal(evaluateMessage(mail({ body: '   ' }), CONFIG, state()).code, 'empty-body')
})

test('enforces the hourly rate limit', () => {
  const now = Date.now()
  assert.equal(evaluateMessage(mail(), CONFIG, state({ runs: [now - 1000, now - 2000] }), now).code, 'rate-limited')
  assert.equal(evaluateMessage(mail(), CONFIG, state({ runs: [now - 1000] }), now).accept, true)
})

test('expired run timestamps do not count toward the limit', () => {
  const now = Date.now()
  const old = now - 2 * 60 * 60 * 1000
  assert.equal(evaluateMessage(mail(), CONFIG, state({ runs: [old, old] }), now).accept, true)
})
