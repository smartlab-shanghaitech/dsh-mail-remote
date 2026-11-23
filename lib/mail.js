import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { parseMail } from './parse.js'

const CONNECTION_TIMEOUT_MS = 20000

function clientFor(config) {
  return new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    tls: { rejectUnauthorized: true },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: 60000,
    clientInfo: { name: 'dsh-mail-remote', version: '0.1.0', vendor: 'dsh-mail-remote' },
  })
}

async function withClient(config, fn) {
  const client = clientFor(config)
  try {
    await client.connect()
  } catch (error) {
    const hint = /auth|login|credential|password/i.test(String(error))
      ? '（检查 QQ 授权码是否正确、网页端是否已开启 IMAP/SMTP 服务）'
      : ''
    throw new Error(`IMAP 连接失败${hint}: ${String(error)}`)
  }
  try {
    const lock = await client.getMailboxLock(config.mailbox, { readOnly: true, acquireTimeout: CONNECTION_TIMEOUT_MS })
    try {
      return await fn(client, lock)
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
}

/** Connectivity + mailbox facts, with no mutation and no message download. */
export async function checkMailbox(config) {
  return withClient(config, async (client) => {
    const uidValidity = String(client.mailbox?.uidValidity ?? '')
    const uids = await client.search({ all: true }, { uid: true })
    const all = Array.isArray(uids) ? uids : []
    return {
      ok: true,
      mailbox: config.mailbox,
      uidValidity,
      exists: client.mailbox?.exists ?? all.length,
      maxUid: all.length > 0 ? Math.max(...all) : 0,
    }
  })
}

export async function verifySmtp(config) {
  const transport = nodemailer.createTransport(smtpOptions(config))
  try {
    await transport.verify()
    return { ok: true }
  } finally {
    transport.close()
  }
}

function smtpOptions(config) {
  return {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: 60000,
  }
}

/**
 * Fetch every message whose UID is greater than the stored cursor.
 * The mailbox is opened read-only: we never set \Seen on the user's mail.
 * @returns {{ uidValidity: string, maxUid: number, mailboxMaxUid: number, messages: object[], truncated: boolean }}
 *   maxUid is the last UID actually fetched (the safe new cursor), not the mailbox tip.
 */
export async function fetchNewMessages(config, state, { limit = 5 } = {}) {
  return withClient(config, async (client) => {
    const uidValidity = String(client.mailbox?.uidValidity ?? '')
    const uids = await client.search({ all: true }, { uid: true })
    const all = (Array.isArray(uids) ? uids : []).sort((a, b) => a - b)
    const maxUid = all.length > 0 ? all[all.length - 1] : 0
    let cursor = Number(state.lastUid) || 0
    const firstRun = state.uidValidity === null || state.uidValidity === '' || state.uidValidity !== uidValidity
    if (firstRun && config.skipExisting !== false) cursor = maxUid
    if (state.uidValidity !== null && state.uidValidity !== '' && state.uidValidity !== uidValidity && config.skipExisting === false) cursor = 0
    const pending = all.filter((uid) => uid > cursor)
    const selected = pending.slice(0, limit)
    const nextUid = selected.length > 0 ? selected[selected.length - 1] : cursor
    const messages = []
    if (selected.length > 0) {
      const range = selected.join(',')
      const rows = await client.fetchAll(range, { uid: true, source: true }, { uid: true })
      const byUid = new Map(rows.map((row) => [row.uid, row]))
      for (const uid of selected) {
        const row = byUid.get(uid)
        if (row === undefined || row.source === undefined) continue
        const mail = await parseMail(row.source)
        messages.push({ ...mail, uid })
      }
    }
    return { uidValidity, maxUid: nextUid, mailboxMaxUid: maxUid, messages, truncated: pending.length > selected.length }
  })
}

/** Reply inside the original thread. Hard-codes the loop-prevention headers. */
export async function sendReply(config, mail, text) {
  const transport = nodemailer.createTransport(smtpOptions(config))
  try {
    const references = [...mail.references, ...(mail.messageId !== null ? [mail.messageId] : [])]
    const subject = /^\s*re\s*:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`
    return await transport.sendMail({
      from: { address: config.user },
      to: mail.fromAddress,
      subject,
      text,
      inReplyTo: mail.messageId ?? undefined,
      references: references.length > 0 ? references : undefined,
      headers: {
        'X-DSH-Auto-Reply': '1',
        'Auto-Submitted': 'auto-replied',
      },
    })
  } finally {
    transport.close()
  }
}

/** One plain connectivity probe (never used on the inbound path). */
export async function sendSelfTest(config) {
  const transport = nodemailer.createTransport(smtpOptions(config))
  try {
    return await transport.sendMail({
      from: { address: config.user },
      to: config.user,
      subject: `${config.replyPrefix} SMTP 自检`,
      text: `dsh-mail-remote SMTP 自检成功\n时间: ${new Date().toISOString()}`,
      headers: { 'X-DSH-Auto-Reply': '1', 'Auto-Submitted': 'auto-replied' },
    })
  } finally {
    transport.close()
  }
}
