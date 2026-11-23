#!/usr/bin/env node
// Download attachments from the newest reply (for end-to-end attachment tests).
// Usage: node dev/fetch-latest-attachment.mjs [out-dir]
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { normalizeConfig } from '../lib/config.js'

const outDir = resolve(process.argv[2] ?? '/tmp/dsh-mail-attachments')
const config = normalizeConfig(JSON.parse(readFileSync(resolve(import.meta.dirname, 'config.local.json'), 'utf8')))
const client = new ImapFlow({
  host: config.imap.host,
  port: config.imap.port,
  secure: config.imap.secure,
  auth: { user: config.user, pass: config.password },
  logger: false,
})
await client.connect()
const lock = await client.getMailboxLock(config.mailbox, { readOnly: true })
try {
  const uids = await client.search({ all: true }, { uid: true })
  const uid = uids[uids.length - 1]
  const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
  const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true })
  mkdirSync(outDir, { recursive: true })
  console.log(`uid=${uid} subject=${parsed.subject}`)
  console.log(`attachments=${parsed.attachments.length}`)
  for (const attachment of parsed.attachments) {
    const target = resolve(outDir, attachment.filename ?? `attachment-${Date.now()}`)
    writeFileSync(target, attachment.content)
    const digest = createHash('sha256').update(attachment.content).digest('hex')
    console.log(`  ${attachment.filename} size=${attachment.size} sha256=${digest}`)
    console.log(`  saved=${target}`)
  }
} finally {
  lock.release()
  await client.logout()
}
