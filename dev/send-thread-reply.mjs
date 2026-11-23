#!/usr/bin/env node
// Send one mail with explicit threading headers.
// Usage: node dev/send-thread-reply.mjs '{"inReplyTo":"<id>","references":["<id>"],"subject":"...","text":"..."}'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import nodemailer from 'nodemailer'
import { normalizeConfig } from '../lib/config.js'

const request = JSON.parse(process.argv[2] ?? '{}')
const config = normalizeConfig(JSON.parse(readFileSync(resolve(import.meta.dirname, 'config.local.json'), 'utf8')))
const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: { user: config.user, pass: config.password },
})
const info = await transport.sendMail({
  from: config.user,
  to: config.user,
  subject: request.subject ?? `${config.subjectToken} Re: 续跑测试`,
  text: request.text ?? '继续',
  inReplyTo: request.inReplyTo,
  references: request.references,
})
transport.close()
console.log(`已发送线程内回信 messageId=${info.messageId}`)
