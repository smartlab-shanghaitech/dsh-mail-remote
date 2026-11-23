#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { describeConfig, normalizeConfig } from '../lib/config.js'
import { evaluateMessage } from '../lib/gate.js'
import { checkMailbox, fetchNewMessages, sendSelfTest, verifySmtp } from '../lib/mail.js'
import { threadKeyOf } from '../lib/parse.js'
import { loadState, saveState } from '../lib/state.js'

const USAGE = `dsh-mail-remote — 邮箱遥控 DSH 的命令行工具（测试/排障用，不执行任务）

用法:
  dsh-mail-remote check    --config <file>            检查 IMAP/SMTP 连通性与邮箱状态
  dsh-mail-remote poll     --config <file> [--dry-run] [--state <file>]
                                                      拉取新邮件并打印闸门判定（不改状态）
  dsh-mail-remote state    --config <file> [--state <file>] [--init]
                                                      打印游标；--init 把游标定位到当前最新一封
  dsh-mail-remote send-test --config <file>           给自己发一封 SMTP 自检邮件

选项:
  --config <file>   配置文件（JSON）；字段与 cordis.patch.yml 的 config 相同
  --state <file>    覆盖状态文件路径（测试时指到工作区内，避免写 ~/.dsh）
  --dry-run         poll 只判定，不执行、不回信、不推进游标
  --init            state 子命令：首次运行时跳过历史邮件，把游标设到最新 UID
  --json            JSON 输出
  -h, --help        显示帮助

说明:
  真实执行（起会话）只在 DSH 宿主内进行；本 CLI 只做连通性、闸门与状态检查。
`

function loadConfig(file, stateOverride) {
  if (file === undefined || file === '') throw new Error('缺少 --config <file>')
  const absolute = resolve(file)
  let raw
  try {
    raw = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new Error(`读取配置失败 ${absolute}: ${error.message}`)
  }
  const config = normalizeConfig(raw)
  if (stateOverride === undefined || stateOverride === '') return config
  return Object.freeze({ ...config, stateFile: resolve(stateOverride) })
}

function printDecision(mail, decision, token) {
  const subject = mail.subject.length > 50 ? `${mail.subject.slice(0, 47)}...` : mail.subject
  const detail = decision.detail === undefined ? '' : `  (${decision.detail})`
  console.log(`uid=${mail.uid} from=${mail.fromAddress} subject="${subject}" -> ${decision.accept ? 'ACCEPT' : `SKIP:${decision.code}`}${detail}`)
  if (decision.accept) {
    const preview = mail.body.replace(/\s+/g, ' ').slice(0, 110)
    console.log(`  正文: ${preview}${mail.body.length > 110 ? '…' : ''}`)
    console.log(`  线程键: ${threadKeyOf(mail, token)}`)
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      state: { type: 'string' },
      json: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      init: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const command = positionals[0]
  if (values.help === true || command === undefined) {
    console.log(USAGE)
    return command === undefined && values.help !== true ? 1 : 0
  }

  if (command === 'check') {
    const config = loadConfig(values.config, values.state)
    const facts = await checkMailbox(config)
    const smtp = await verifySmtp(config)
    if (values.json === true) {
      console.log(JSON.stringify({ config: describeConfig(config), imap: facts, smtp }, null, 2))
      return 0
    }
    console.log('配置:')
    for (const [key, value] of Object.entries(describeConfig(config))) console.log(`  ${key}: ${JSON.stringify(value)}`)
    console.log('\nIMAP:')
    console.log(`  连接成功  ${facts.mailbox}  exists=${facts.exists}  UIDVALIDITY=${facts.uidValidity}  maxUid=${facts.maxUid}`)
    console.log('\nSMTP:')
    console.log('  连接与认证成功')
    return 0
  }

  if (command === 'state') {
    const config = loadConfig(values.config, values.state)
    if (values.init === true) {
      const facts = await checkMailbox(config)
      const state = loadState(config.stateFile)
      state.uidValidity = facts.uidValidity
      state.lastUid = facts.maxUid
      state.done = {}
      state.threads = {}
      saveState(config.stateFile, state)
      console.log(`已初始化游标: ${config.stateFile}  UIDVALIDITY=${facts.uidValidity}  lastUid=${facts.maxUid}（已跳过历史邮件）`)
      return 0
    }
    const state = loadState(config.stateFile)
    console.log(JSON.stringify({
      stateFile: config.stateFile,
      uidValidity: state.uidValidity,
      lastUid: state.lastUid,
      done: Object.keys(state.done).length,
      threads: Object.keys(state.threads).length,
      runsLastHour: state.runs.length,
      inflight: Object.keys(state.inflight).length,
      updatedAt: state.updatedAt === 0 ? null : new Date(state.updatedAt).toISOString(),
    }, null, 2))
    return 0
  }

  if (command === 'poll') {
    const base = loadConfig(values.config, values.state)
    const config = values['dry-run'] === true ? Object.freeze({ ...base, dryRun: true }) : base
    const state = loadState(config.stateFile)
    const { uidValidity, maxUid, messages, truncated } = await fetchNewMessages(config, state)
    if (values.json === true) {
      console.log(JSON.stringify({
        uidValidity,
        cursor: state.lastUid,
        maxUid,
        truncated,
        messages: messages.map((mail) => ({ uid: mail.uid, from: mail.fromAddress, subject: mail.subject, decision: evaluateMessage(mail, config, state) })),
      }, null, 2))
      return 0
    }
    console.log(`邮箱 ${config.mailbox}  UIDVALIDITY=${uidValidity}  游标=${state.lastUid}  本次待处理 ${messages.length} 封${truncated ? '（达到上限，其余下轮）' : ''}`)
    if (messages.length === 0) {
      if (state.uidValidity === null) console.log('首次运行：已按 skipExisting 跳过历史邮件，等待新邮件。')
      else console.log('没有新邮件。')
      return 0
    }
    for (const mail of messages) printDecision(mail, evaluateMessage(mail, config, state), config.subjectToken)
    if (config.dryRun === true) console.log('\n(dry-run: 不执行、不回信、不推进游标)')
    return 0
  }

  if (command === 'send-test') {
    const config = loadConfig(values.config, values.state)
    await sendSelfTest(config)
    console.log(`已向 ${config.user} 发送自检邮件（带 X-DSH-Auto-Reply，不会被本插件当成任务）`)
    return 0
  }

  console.error(`未知命令: ${command}\n`)
  console.log(USAGE)
  return 1
}

main().then(
  (code) => process.exit(code ?? 0),
  (error) => {
    console.error(`错误: ${error.message}`)
    process.exit(1)
  },
)
