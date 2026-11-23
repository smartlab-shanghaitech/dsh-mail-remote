#!/usr/bin/env node
// Send one command mail to the configured mailbox (same address by default).
// Usage: node dev/send-one.mjs "[DSH-7f3a] 端到端测试" "用一句话回答：现在几点？"
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import nodemailer from 'nodemailer'
import { normalizeConfig } from '../lib/config.js'

const config = normalizeConfig(JSON.parse(readFileSync(resolve(import.meta.dirname, 'config.local.json'), 'utf8')))
const subject = process.argv[2] ?? `${config.subjectToken} 端到端测试`
const text = process.argv[3] ?? '用一句话回答：现在几点？不要修改任何文件。'

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: { user: config.user, pass: config.password },
})
const info = await transport.sendMail({ from: config.user, to: config.user, subject, text })
transport.close()
console.log(`已发送: ${subject}  messageId=${info.messageId}`)
