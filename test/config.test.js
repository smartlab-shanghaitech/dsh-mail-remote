import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeConfig } from '../lib/config.js'

function tempPassFile(content) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mail-remote-pass-'))
  const file = join(dir, 'mail.pass')
  writeFileSync(file, content)
  chmodSync(file, 0o600)
  return { dir, file }
}

test('defaults to the qq endpoints and read-only permission', () => {
  const config = normalizeConfig({})
  assert.equal(config.provider, 'qq')
  assert.equal(config.imap.host, 'imap.qq.com')
  assert.equal(config.imap.port, 993)
  assert.equal(config.smtp.host, 'smtp.qq.com')
  assert.equal(config.smtp.port, 465)
  assert.equal(config.permissionPreset, 'workspace-write')
  assert.equal(config.approvalPolicy, 'never')
  assert.equal(config.enabled, false)
  assert.equal(config.workspaceName, 'remote-dsh')
  assert.equal(config.attachChangedFiles, true)
  assert.equal(config.maxAttachmentFiles, 5)
})

test('rejects an unknown provider', () => {
  assert.throws(() => normalizeConfig({ provider: 'nope' }), /未知 provider/)
})

test('enabled requires user, password, allowFrom and subjectToken', () => {
  assert.throws(() => normalizeConfig({ enabled: true }), /必须配置 user/)
  assert.throws(
    () => normalizeConfig({ enabled: true, user: 'a@qq.com' }),
    /找不到邮箱授权码/,
  )
  assert.throws(
    () => normalizeConfig({ enabled: true, user: 'a@qq.com', password: 'x' }),
    /必须配置 allowFrom/,
  )
  assert.throws(
    () => normalizeConfig({ enabled: true, user: 'a@qq.com', password: 'x', allowFrom: ['a@qq.com'] }),
    /必须配置 subjectToken/,
  )
})

test('reads the authorization code from passwordFile', () => {
  const { dir, file } = tempPassFile('abcd1234\n')
  try {
    const config = normalizeConfig({
      enabled: true,
      user: 'a@qq.com',
      passwordFile: file,
      allowFrom: ['a@qq.com'],
      subjectToken: '[DSH-7f3a]',
    })
    assert.equal(config.password, 'abcd1234')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reads the authorization code from the environment when no file is set', () => {
  const previous = process.env.DSH_MAIL_REMOTE_PASSWORD
  process.env.DSH_MAIL_REMOTE_PASSWORD = 'env-secret'
  try {
    const config = normalizeConfig({
      enabled: true,
      user: 'a@qq.com',
      allowFrom: ['a@qq.com'],
      subjectToken: '[DSH-7f3a]',
    })
    assert.equal(config.password, 'env-secret')
  } finally {
    if (previous === undefined) delete process.env.DSH_MAIL_REMOTE_PASSWORD
    else process.env.DSH_MAIL_REMOTE_PASSWORD = previous
  }
})

test('normalizes allowFrom and clamps bounds', () => {
  assert.throws(() => normalizeConfig({ pollSeconds: 1 }), /pollSeconds/)
  const config = normalizeConfig({ allowFrom: 'A@QQ.com, b@qq.com', maxPerHour: 3 })
  assert.deepEqual(config.allowFrom, ['a@qq.com', 'b@qq.com'])
  assert.equal(config.maxPerHour, 3)
})
