import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectChangedFiles } from '../lib/attachments.js'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mail-attach-'))
  const old = join(dir, 'old.txt')
  writeFileSync(old, 'old')
  const past = new Date(Date.now() - 60 * 60 * 1000)
  utimesSync(old, past, past)
  writeFileSync(join(dir, 'new.txt'), 'new content')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'nested.txt'), 'nested')
  writeFileSync(join(dir, '.secret'), 'hidden')
  mkdirSync(join(dir, 'node_modules'))
  writeFileSync(join(dir, 'node_modules', 'dep.txt'), 'dep')
  return dir
}

test('collects only files touched after the turn started, skipping hidden and node_modules', async () => {
  const dir = setup()
  try {
    const files = await collectChangedFiles(dir, Date.now() - 5000)
    const names = files.map((file) => file.filename).sort()
    assert.deepEqual(names, ['nested.txt', 'new.txt'])
    assert.ok(files.every((file) => file.path.startsWith(dir)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('respects the file count cap', async () => {
  const dir = setup()
  try {
    const files = await collectChangedFiles(dir, Date.now() - 5000, { maxFiles: 1 })
    assert.equal(files.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('skips empty files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mail-attach-empty-'))
  try {
    writeFileSync(join(dir, 'zero.txt'), '')
    const files = await collectChangedFiles(dir, Date.now() - 5000)
    assert.equal(files.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractAttachmentMarkers pulls marker lines out of the reply', async () => {
  const { extractAttachmentMarkers } = await import('../lib/attachments.js')
  const result = extractAttachmentMarkers('已复制。\n[ATTACH: /tmp/a.pdf]\n[attach: /tmp/b.png]\n完成')
  assert.equal(result.paths.length, 2)
  assert.deepEqual(result.paths, ['/tmp/a.pdf', '/tmp/b.png'])
  assert.ok(!result.text.includes('ATTACH'))
  assert.ok(result.text.includes('已复制'))
})

test('explicit attachments are limited to the allowed roots', async () => {
  const { collectExplicitAttachments } = await import('../lib/attachments.js')
  const root = mkdtempSync(join(tmpdir(), 'dsh-mail-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'dsh-mail-outside-'))
  try {
    writeFileSync(join(root, 'ok.txt'), 'ok')
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    const allowed = await collectExplicitAttachments([join(root, 'ok.txt')], { roots: [root] })
    assert.equal(allowed.length, 1)
    assert.equal(allowed[0].filename, 'ok.txt')
    const rejected = await collectExplicitAttachments([join(outside, 'secret.txt')], { roots: [root] })
    assert.equal(rejected.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
