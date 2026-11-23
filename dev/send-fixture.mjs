#!/usr/bin/env node
// Sends three fixture mails so the gates can be exercised without a phone.
// Usage: node dev/send-fixture.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import nodemailer from 'nodemailer'
import { normalizeConfig } from '../lib/config.js'

const config = normalizeConfig(JSON.parse(readFileSync(resolve(import.meta.dirname, 'config.local.json'), 'utf8')))
const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: { user: config.user, pass: config.password },
})

const fixtures = [
  {
    label: 'ACCEPT 用例（口令 + 白名单 + 正文）',
    subject: `${config.subjectToken} 连通性测试：只读问答`,
    text: '用一句话回答：现在几点？不要修改任何文件。\n\n-- \n发自 iPhone',
  },
  {
    label: 'SKIP 用例（主题没有口令）',
    subject: '没有口令的测试',
    text: '这条应该被闸门以 missing-token 拒掉。',
  },
  {
    label: 'SKIP 用例（自动回复标记）',
    subject: `${config.subjectToken} 自动回复测试`,
    text: '这条应该被 self-reply 拒掉。',
    headers: { 'X-DSH-Auto-Reply': '1', 'Auto-Submitted': 'auto-replied' },
  },
]

for (const fixture of fixtures) {
  const info = await transport.sendMail({
    from: config.user,
    to: config.user,
    subject: fixture.subject,
    text: fixture.text,
    headers: fixture.headers,
  })
  console.log(`已发送 [${fixture.label}] messageId=${info.messageId}`)
}
transport.close()
