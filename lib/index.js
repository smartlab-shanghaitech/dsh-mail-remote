import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Config } from './schema.js'
import { normalizeConfig } from './config.js'
import { evaluateMessage, RATE_WINDOW_MS } from './gate.js'
import { fetchNewMessages, sendReply } from './mail.js'
import { replyTextOf, subjectThreadKey, taskTextOf, threadKeyOf } from './parse.js'
import { collectChangedFiles, collectExplicitAttachments, extractAttachmentMarkers } from './attachments.js'
import { attachToWorkspace, createHostRunner, ensureWorkspace } from './runner-host.js'
import { loadState, pruneRuns, saveState, StateLock } from './state.js'

export const name = 'mail-remote'

/** Single source of truth: the installed package's version, not a hardcoded copy. */
const VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
})()

const POLL_LIMIT_PER_TICK = 5
const FIRST_POLL_DELAY_MS = 3000

function loggerOf(ctx) {
  const logger = ctx.logger
  return {
    info: (message) => logger?.info?.(message),
    warn: (message) => logger?.warn?.(message),
    error: (message) => logger?.error?.(message),
  }
}

function describeError(error) {
  if (error !== null && typeof error === 'object') {
    const details = 'details' in error && error.details !== undefined ? ` details=${JSON.stringify(error.details)}` : ''
    const code = 'code' in error && error.code !== undefined ? ` code=${String(error.code)}` : ''
    return `${error.name ?? 'Error'}: ${error.message ?? String(error)}${code}${details}`
  }
  return String(error)
}

function writeDiag(config, payload) {
  try {
    const dir = dirname(config.stateFile)
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/diag.json`, JSON.stringify({ version: VERSION, ...payload, at: Date.now() }, null, 2))
  } catch {
    /* diagnostics must never break the channel */
  }
}

function shortSubject(subject) {
  return subject.length > 60 ? `${subject.slice(0, 57)}...` : subject
}

/**
 * One poll pass. Cursor advancement is deliberately delayed to the end: a crash
 * midway reprocesses, but `done` (Message-ID) makes the reprocess idempotent.
 */
async function pollOnce({ config, runner, log }) {
  const lock = new StateLock(config.stateFile)
  if (!lock.acquire()) {
    log.info('[mail-remote] 另一个实例正在处理，本轮跳过')
    return { skipped: 'locked' }
  }
  try {
    const state = loadState(config.stateFile)
    const { uidValidity, maxUid, messages, truncated } = await fetchNewMessages(config, state, {
      limit: POLL_LIMIT_PER_TICK,
    })
    if (state.uidValidity !== null && state.uidValidity !== '' && state.uidValidity !== uidValidity) {
      log.warn(`[mail-remote] UIDVALIDITY 变化 ${state.uidValidity} -> ${uidValidity}，游标重置`)
      state.uidValidity = uidValidity
      state.lastUid = 0
      state.done = {}
      state.threads = {}
    } else {
      state.uidValidity = uidValidity
    }

    const processed = []
    for (const mail of messages) {
      const decision = evaluateMessage(mail, config, state)
      if (!decision.accept) {
        log.info(`[mail-remote] 跳过 uid=${mail.uid} ${mail.messageId ?? ''} 原因=${decision.code}${decision.detail ? ` (${decision.detail})` : ''}`)
        // A trusted sender whose mail was rate-limited should not be left guessing.
        if (decision.code === 'rate-limited' && config.replyEnabled === true && config.dryRun !== true) {
          try {
            await sendReply(
              config,
              mail,
              `⚠️ 这封任务没有执行：最近 1 小时已执行 ${config.maxPerHour} 次（maxPerHour 上限）。请稍后再发，或调高配置里的 maxPerHour。`,
            )
          } catch (error) {
            log.error(`[mail-remote] 限频提示回信失败：${String(error)}`)
          }
        }
        continue
      }
      if (config.dryRun) {
        log.info(`[mail-remote] dry-run 命中 uid=${mail.uid} from=${mail.fromAddress} subject="${shortSubject(mail.subject)}"`)
        processed.push({ uid: mail.uid, action: 'dry-run' })
        continue
      }

      const key = threadKeyOf(mail, config.subjectToken)
      const subjectKey = subjectThreadKey(mail, config.subjectToken)
      const previous = state.threads[key]?.sessionId ?? state.threads[subjectKey]?.sessionId
      state.inflight[mail.messageId ?? `uid:${mail.uid}`] = Date.now()
      saveState(config.stateFile, state)
      const startedAt = Date.now()
      const turnStartedAt = startedAt - 2000
      try {
        const result = await runner.runTask({
          text: taskTextOf(mail, config),
          sessionId: previous,
          messageId: mail.messageId ?? `uid:${mail.uid}`,
        })
        const durationMs = Date.now() - startedAt
        state.done[mail.messageId ?? `uid:${mail.uid}`] = { at: Date.now(), sessionId: result.sessionId }
        const threadRecord = { sessionId: result.sessionId, subject: mail.subject, updatedAt: Date.now() }
        state.threads[key] = threadRecord
        if (state.threads[subjectKey] === undefined) state.threads[subjectKey] = threadRecord
        state.runs.push(startedAt)
        pruneRuns(state, Date.now(), RATE_WINDOW_MS)

        // Attachments: explicit [ATTACH: /path] markers first, then files the
        // turn created or modified inside the workspace.
        const marked = extractAttachmentMarkers(result.text ?? '')
        let attachments = []
        if (config.attachChangedFiles === true && result.ok) {
          if (marked.paths.length > 0) {
            try {
              attachments = await collectExplicitAttachments(marked.paths, {
                roots: config.attachmentRoots,
                maxFiles: config.maxAttachmentFiles,
                maxFileBytes: config.maxAttachmentBytes,
                maxTotalBytes: config.maxAttachmentBytes * 2,
              })
            } catch (error) {
              log.warn(`[mail-remote] 显式附件校验失败：${String(error)}`)
            }
          }
          try {
            const seen = new Set(attachments.map((item) => `${item.filename}:${item.size}`))
            const changed = (await collectChangedFiles(config.workdir, turnStartedAt, {
              maxFiles: config.maxAttachmentFiles,
              maxFileBytes: config.maxAttachmentBytes,
              maxTotalBytes: config.maxAttachmentBytes * 2,
            })).filter((item) => !seen.has(`${item.filename}:${item.size}`))
            attachments = [...attachments, ...changed].slice(0, config.maxAttachmentFiles)
          } catch (error) {
            log.warn(`[mail-remote] 收集附件失败：${String(error)}`)
          }
        }
        if (config.replyEnabled) {
          try {
            const replyBody = marked.text !== '' ? marked.text : (result.text ?? '')
            await sendReply(config, mail, replyTextOf({ ...result, text: replyBody, durationMs }, result.sessionId, attachments), attachments)
            if (attachments.length > 0) log.info(`[mail-remote] 回信附带 ${attachments.length} 个文件：${attachments.map((item) => item.filename).join(', ')}`)
          } catch (error) {
            log.error(`[mail-remote] 回信失败 uid=${mail.uid}：${String(error)}`)
          }
        }
        processed.push({ uid: mail.uid, action: result.ok ? 'completed' : 'failed', sessionId: result.sessionId })
        log.info(`[mail-remote] 完成 uid=${mail.uid} session=${result.sessionId} ok=${result.ok} ${durationMs}ms`)
      } catch (error) {
        state.done[mail.messageId ?? `uid:${mail.uid}`] = { at: Date.now(), sessionId: null, error: describeError(error) }
        log.error(`[mail-remote] 执行失败 uid=${mail.uid}：${describeError(error)}`)
        if (config.replyEnabled) {
          try {
            await sendReply(config, mail, replyTextOf({ ok: false, text: `执行端报错：${describeError(error)}`, reason: 'runner-error' }))
          } catch (replyError) {
            log.error(`[mail-remote] 失败回信也失败：${String(replyError)}`)
          }
        }
        processed.push({ uid: mail.uid, action: 'error' })
      } finally {
        delete state.inflight[mail.messageId ?? `uid:${mail.uid}`]
        saveState(config.stateFile, state)
      }
    }

    if (config.dryRun) return { uidValidity, maxUid, processed, truncated, dryRun: true }
    state.lastUid = Math.max(Number(state.lastUid) || 0, maxUid)
    saveState(config.stateFile, state)
    return { uidValidity, maxUid, processed, truncated }
  } finally {
    lock.release()
  }
}

/**
 * Host plugin entry point. Registers a host-side timer only; the mailbox is
 * opened read-only and the cursor lives beside the plugin state.
 */
export function apply(ctx, rawConfig = {}) {
  const log = loggerOf(ctx)
  let config
  try {
    config = normalizeConfig(rawConfig)
  } catch (error) {
    log.error(`[mail-remote] 配置无效，插件不启动：${String(error)}`)
    return
  }
  if (!config.enabled) {
    log.info('[mail-remote] enabled=false，插件待命（不会连接邮箱）')
    return
  }
  try {
    mkdirSync(config.workdir, { recursive: true })
  } catch (error) {
    log.error(`[mail-remote] 无法创建工作目录 ${config.workdir}：${String(error)}`)
    return
  }

  const runner = createHostRunner(ctx, config)
  // Group the channel's sessions under a named Workspace instead of "Ungrouped".
  void ensureWorkspace(ctx, config).then(async () => {
    try {
      const state = loadState(config.stateFile)
      for (const thread of Object.values(state.threads)) {
        if (thread !== null && typeof thread === 'object' && typeof thread.sessionId === 'string') {
          await attachToWorkspace(ctx, config, thread.sessionId)
        }
      }
    } catch (error) {
      log.warn(`[mail-remote] 迁移已有会话到工作区失败：${String(error)}`)
    }
  })
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const result = await pollOnce({ config, runner, log })
      writeDiag(config, { status: 'polling', lastUid: result?.maxUid ?? null, processed: result?.processed?.length ?? 0 })
      if (result?.truncated) log.info('[mail-remote] 本轮达到处理上限，剩余邮件下一轮继续')
    } catch (error) {
      writeDiag(config, { status: 'error', message: String(error) })
      log.error(`[mail-remote] 轮询失败：${String(error)}`)
    } finally {
      busy = false
    }
  }

  ctx.effect(() => {
    const first = setTimeout(() => void tick(), FIRST_POLL_DELAY_MS)
    first.unref?.()
    const every = setInterval(() => void tick(), config.pollSeconds * 1000)
    every.unref?.()
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, 'mail-remote.poll')

  writeDiag(config, { status: 'active', user: config.user, workdir: config.workdir, pollSeconds: config.pollSeconds })
  log.info(`[mail-remote] 已启动：${config.user} 每 ${config.pollSeconds}s 轮询 ${config.mailbox}，权限档 ${config.permissionPreset}/${config.approvalPolicy}，工作目录 ${config.workdir}`)
}

export { Config, pollOnce }
