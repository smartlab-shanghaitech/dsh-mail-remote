import { randomUUID } from 'node:crypto'

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
const TURN_START_WAIT_MS = 10000

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  Object.freeze(value)
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return value
}

/**
 * Build the same immutable user message shape `@deepseek-ai/dsh-llm` produces.
 * We do not import the core package: plugins resolve their own dependencies,
 * and the Host owns the LLM package. structuredClone + deepFreeze is the whole
 * contract the Session log needs (lossless JSON + frozen).
 */
function createMailUserMessage({ text, messageId }) {
  const rpcId = `mail-remote-${messageId ?? ''}-${randomUUID()}`
  return deepFreeze(
    structuredClone({
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user', rpcId, clientTimeZone: 'Asia/Shanghai' },
      id: randomUUID(),
    }),
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function summarize(events) {
  let started = false
  let text = ''
  let reason
  for (const event of events) {
    if (event.type === 'turn/start') {
      started = true
      reason = undefined
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const blocks = event.data?.message?.content
      const joined = Array.isArray(blocks)
        ? blocks.filter((block) => block.type === 'text').map((block) => block.text).join('')
        : ''
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data?.reason
  }
  return { text, reason }
}

function describe(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function reasonKind(reason) {
  if (reason === undefined || reason === null) return ''
  if (typeof reason === 'string') return reason
  return String(reason.kind ?? reason.type ?? '')
}

function applyPermission(ctx, agent, config, log) {
  const session = agent.session
  const presets = ctx.get('permissionPresets')
  if (presets !== undefined && typeof presets.set === 'function') {
    try {
      presets.set(session, config.permissionPreset)
    } catch (error) {
      log?.warn?.(`[mail-remote] 设置权限档失败（继续用默认档）：${String(error)}`)
    }
  } else {
    log?.warn?.('[mail-remote] 没有 permissionPresets 服务，沿用当前默认权限档')
  }
  // read-only still carries approval=ask; ask would hang forever with nobody at
  // the GUI, so this channel pins its own durable approval policy.
  try {
    session.append('approval/policy', { policy: config.approvalPolicy })
  } catch (error) {
    log?.warn?.(`[mail-remote] 写入审批策略失败：${String(error)}`)
  }
}

async function waitForTurnStart(agent, events) {
  const deadline = Date.now() + TURN_START_WAIT_MS
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === 'turn/start')) return true
    await sleep(100)
  }
  return false
}

function waitIdle(agent, timeoutMs) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
    timer.unref?.()
  })
  const idle = agent.whenIdle().then(() => 'idle')
  return Promise.race([idle, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Create or resume one DSH Session, run exactly one turn, and return its final
 * assistant text. Nothing here spawns a process: all calls go through the live
 * Host services, so the task shows up in the desktop session list.
 * @param ctx - Cordis host plugin context.
 * @param config - normalized plugin config (workdir / permissionPreset / approvalPolicy).
 */
export function createHostRunner(ctx, config) {
  if (typeof ctx.get !== 'function' || typeof ctx.on !== 'function') {
    throw new Error('createHostRunner 需要一个 Cordis 插件上下文')
  }
  return {
    async runTask({ text, sessionId, messageId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
      const log = ctx.logger
      const controller = ctx.get('sessionController')
      if (controller === undefined) {
        throw new Error('当前 profile 没有 sessionController；邮件遥控需要 desktop/web（含 dsh-web-app bundle）')
      }

      let sid = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
      let created = false
      let agent

      // sessionController.resolveAgent() resolves to an envelope: { agent } or { error }.
      const resolveLive = async (id) => {
        const found = await controller.resolveAgent(id)
        if (found !== null && typeof found === 'object' && 'error' in found && found.error !== undefined) throw found.error
        const resolved = found !== null && typeof found === 'object' && 'agent' in found ? found.agent : found
        if (resolved === undefined || typeof resolved?.followup !== 'function') {
          throw new Error(`会话 ${id} 没有可用的 Agent.followup（拿到 ${typeof resolved}）`)
        }
        return resolved
      }

      if (sid !== undefined) {
        try {
          agent = await resolveLive(sid)
        } catch (error) {
          log?.warn?.(`[mail-remote] 会话 ${sid} 无法恢复（${describe(error)}），改为新建`)
          sid = undefined
        }
      }
      if (sid === undefined) {
        const result = await controller.create({
          cwd: config.workdir,
          ...(config.agentPreset !== '' ? { agentPreset: config.agentPreset } : {}),
        })
        sid = result.sessionId
        created = true
        agent = await resolveLive(sid)
      }

      applyPermission(ctx, agent, config, log)

      const events = []
      const off = ctx.on('session/event', (session, event) => {
        if (session?.id === sid) events.push(event)
      })
      try {
        agent.followup(createMailUserMessage({ text, messageId }))
        const sessions = ctx.get('sessions')
        if (sessions !== undefined && typeof sessions.flush === 'function') {
          if (!(await sessions.flush(agent.session))) throw new Error('会话持久化未确认')
        }
        await waitForTurnStart(agent, events)
        const outcome = await waitIdle(agent, timeoutMs)
        const summary = summarize(events)
        const kind = reasonKind(summary.reason)
        return {
          ok: kind === 'completed',
          text: summary.text,
          reason: outcome === 'timeout' ? 'timeout' : kind,
          sessionId: sid,
          created,
          timedOut: outcome === 'timeout',
        }
      } finally {
        off?.()
      }
    },
  }
}
