import { subjectHasToken } from './parse.js'

const RATE_WINDOW_MS = 60 * 60 * 1000

/**
 * Decide whether one parsed message may drive a DSH turn.
 * Gate order is security-first: loop/auto-reply filters, sender allowlist,
 * subject token, dedupe, body, rate limit.
 * @returns {{ accept: boolean, code: string, detail?: string }}
 */
export function evaluateMessage(mail, config, state, now = Date.now()) {
  const headers = mail.headers ?? {}

  // 1. Never answer our own replies (prevents mail loops).
  if (String(headers['x-dsh-auto-reply'] ?? '').trim() === '1') {
    return skip('self-reply', 'X-DSH-Auto-Reply 标记')
  }
  const autoSubmitted = String(headers['auto-submitted'] ?? '').trim().toLowerCase()
  if (autoSubmitted !== '' && autoSubmitted !== 'no') {
    return skip('auto-submitted', `Auto-Submitted: ${autoSubmitted}`)
  }
  const precedence = String(headers['precedence'] ?? '').trim().toLowerCase()
  if (precedence === 'bulk' || precedence === 'junk' || precedence === 'list') {
    return skip('bulk', `Precedence: ${precedence}`)
  }

  // 2. Exact sender allowlist. Substring / domain matching is deliberately absent.
  if (!config.allowFrom.includes(mail.fromAddress)) {
    return skip('from-not-allowed', mail.fromAddress || '(空发件人)')
  }

  // 3. Subject token — prevents a leaked address from being enough.
  if (!subjectHasToken(mail.subject, config.subjectToken)) {
    return skip('missing-token', `主题缺少 ${config.subjectToken}`)
  }

  // 4. Dedupe by Message-ID.
  if (mail.messageId !== null && state.done[mail.messageId] !== undefined) {
    return skip('duplicate', mail.messageId)
  }

  // 5. Empty body means nothing to run.
  if (mail.body.trim() === '') {
    return skip('empty-body', '正文清洗后为空')
  }

  // 6. Rate limit.
  const recent = state.runs.filter((at) => typeof at === 'number' && now - at < RATE_WINDOW_MS)
  if (recent.length >= config.maxPerHour) {
    return skip('rate-limited', `最近 1 小时已执行 ${recent.length} 次（上限 ${config.maxPerHour}）`)
  }

  return { accept: true, code: 'accept' }
}

function skip(code, detail) {
  return { accept: false, code, ...(detail === undefined ? {} : { detail }) }
}

export { RATE_WINDOW_MS }
