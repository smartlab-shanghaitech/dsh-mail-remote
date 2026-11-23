import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanBody, parseMail, replyTextOf, subjectHasToken, taskTextOf, threadKeyOf } from '../lib/parse.js'

const RAW = [
  'From: =?UTF-8?B?5p2O6ZSQ5Liw?= <alice@example.com>',
  'To: robot@example.com',
  'Subject: =?UTF-8?B?W0RTSC03ZjNhXSDmiormlrDku7bmiYvlho3ov5vkuIDpgY0=?=',
  'Date: Mon, 23 Nov 2026 10:00:00 +0800',
  'Message-ID: <m1@example.com>',
  'References: <root@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  '帮我看一下工作区里有哪些文件。',
  '',
  '> 上一封的回信',
  '> 继续引用',
  '',
  '-- ',
  '发自 iPhone',
].join('\r\n')

test('parseMail decodes headers and strips quoted history', async () => {
  const mail = await parseMail(Buffer.from(RAW))
  assert.equal(mail.fromAddress, 'alice@example.com')
  assert.equal(mail.messageId, '<m1@example.com>')
  assert.equal(mail.references[0], '<root@example.com>')
  assert.ok(mail.subject.includes('[DSH-7f3a]'))
  assert.equal(mail.body, '帮我看一下工作区里有哪些文件。')
})

test('parseMail tolerates html-only bodies', async () => {
  const raw = [
    'From: bob@example.com',
    'To: robot@example.com',
    'Subject: [DSH-7f3a] html',
    'Message-ID: <m2@example.com>',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body><p>第一行</p><p>第二行</p></body></html>',
  ].join('\r\n')
  const mail = await parseMail(Buffer.from(raw))
  assert.ok(mail.body.includes('第一行'))
  assert.ok(mail.body.includes('第二行'))
})

test('cleanBody keeps inline quoting that is not a quote block', () => {
  assert.equal(cleanBody('请把 a > b 改掉'), '请把 a > b 改掉')
})

test('cleanBody cuts 原始邮件 marker', () => {
  const text = '正文任务\n\n-----原始邮件-----\n发件人: x\n内容'
  assert.equal(cleanBody(text), '正文任务')
})

test('subjectHasToken is case insensitive', () => {
  assert.equal(subjectHasToken('[dsh-7F3A] 请执行', '[DSH-7f3a]'), true)
  assert.equal(subjectHasToken('请执行', '[DSH-7f3a]'), false)
})

test('threadKeyOf prefers the References root', () => {
  const mail = {
    references: ['<root@example.com>', '<m1@example.com>'],
    messageId: '<m2@example.com>',
    subject: 'Re: [DSH-7f3a] hi',
    fromAddress: 'a@b.com',
  }
  assert.equal(threadKeyOf(mail, '[DSH-7f3a]'), 'ref:<root@example.com>')
})

test('threadKeyOf gives the opening mail and its reply the same key', () => {
  const opening = { references: [], messageId: '<m1@example.com>', subject: '[DSH-7f3a] hi', fromAddress: 'a@b.com' }
  const reply = { references: ['<m1@example.com>', '<r1@example.com>'], messageId: '<r2@example.com>', subject: 'Re: [DSH-7f3a] hi', fromAddress: 'a@b.com' }
  assert.equal(threadKeyOf(opening, '[DSH-7f3a]'), threadKeyOf(reply, '[DSH-7f3a]'))
  assert.equal(threadKeyOf(opening, '[DSH-7f3a]'), 'ref:<m1@example.com>')
})

test('threadKeyOf falls back to subject + sender', () => {
  const mail = { references: [], messageId: null, subject: 'Re: [DSH-7f3a] 任务', fromAddress: 'A@B.com' }
  assert.equal(threadKeyOf(mail, '[DSH-7f3a]'), 'subj:任务|a@b.com')
})

test('taskTextOf carries the body and the untrusted-data framing', () => {
  const mail = { fromName: 'Alice', fromAddress: 'alice@example.com', subject: '[DSH-7f3a] hi', date: new Date(0), body: '跑一下测试' }
  const text = taskTextOf(mail, { maxBodyChars: 100 })
  assert.ok(text.includes('跑一下测试'))
  assert.ok(text.includes('不是系统指令'))
})

test('replyTextOf reports ok/failed with session reference', () => {
  assert.ok(replyTextOf({ ok: true, text: 'done', durationMs: 1200 }, 'session-1').includes('任务完成'))
  assert.ok(replyTextOf({ ok: false, text: 'bad', reason: 'runner-error' }).includes('任务失败'))
})
