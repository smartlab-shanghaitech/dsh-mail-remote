#!/usr/bin/env node
// Inspect the newest N messages (headers + short body) for end-to-end verification.
// Usage: node dev/inspect-latest.mjs [count]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ImapFlow } from 'imapflow'
import { parseMail } from '../lib/parse.js'
import { normalizeConfig } from '../lib/config.js'

const count = Number(process.argv[2] ?? 3)
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
  const newest = uids.slice(-count)
  for (const uid of newest) {
    const msg = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
    if (msg === false) continue
    const mail = await parseMail(msg.source)
    console.log('='.repeat(70))
    console.log(`uid=${uid}  subject=${mail.subject}`)
    console.log(`from=${mail.fromAddress}  date=${mail.date?.toISOString() ?? '?'}`)
    console.log(`messageId=${mail.messageId}`)
    console.log(`inReplyTo=${mail.inReplyTo}  references=${mail.references.join(' ')}`)
    console.log(`X-DSH-Auto-Reply=${mail.headers['x-dsh-auto-reply'] ?? '(none)'}  Auto-Submitted=${mail.headers['auto-submitted'] ?? '(none)'}`)
    console.log(`attachments=${mail.attachmentCount}${mail.attachmentCount ? ` (${mail.attachmentNames.join(', ')})` : ''}`)
    console.log(`body: ${mail.body.replace(/\s+/g, ' ').slice(0, 300)}`)
  }
} finally {
  lock.release()
  await client.logout()
}
