import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Built-in IMAP/SMTP endpoints. Keep in sync with dsh-email's PROVIDER_PRESETS. */
export const PROVIDER_PRESETS = {
  qq: { imap: { host: 'imap.qq.com', port: 993, secure: true }, smtp: { host: 'smtp.qq.com', port: 465, secure: true } },
  '163': { imap: { host: 'imap.163.com', port: 993, secure: true }, smtp: { host: 'smtp.163.com', port: 465, secure: true } },
  '126': { imap: { host: 'imap.126.com', port: 993, secure: true }, smtp: { host: 'smtp.126.com', port: 465, secure: true } },
}

const PERMISSION_PRESETS = new Set(['read-only', 'workspace-write'])
const APPROVAL_POLICIES = new Set(['ask', 'never'])

export function expandHome(value) {
  const text = String(value ?? '').trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return text
}

export function dshHome() {
  const value = process.env.DSH_HOME
  return value !== undefined && value.trim() !== '' ? resolve(expandHome(value)) : join(homedir(), '.dsh')
}

function asBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  throw new Error(`dsh-mail-remote: 无法解析布尔值 ${JSON.stringify(value)}`)
}

function asInt(value, fallback, name, min, max) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`dsh-mail-remote: ${name} 必须是 ${min}~${max} 的整数，收到 ${JSON.stringify(value)}`)
  }
  return parsed
}

function endpoint(value, fallback, name) {
  const raw = value !== null && typeof value === 'object' ? value : {}
  const host = String(raw.host ?? fallback.host).trim()
  const port = asInt(raw.port, fallback.port, `${name}.port`, 1, 65535)
  const secure = asBool(raw.secure, fallback.secure)
  if (host === '') throw new Error(`dsh-mail-remote: ${name}.host 不能为空`)
  return { host, port, secure }
}

function readPassword(raw) {
  const inline = String(raw.password ?? '').trim()
  if (inline !== '') return inline

  const envName = String(raw.passwordEnv ?? 'DSH_MAIL_REMOTE_PASSWORD').trim()
  const fromEnv = envName !== '' ? process.env[envName] : undefined
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim()

  const configuredFile = String(raw.passwordFile ?? '').trim()
  const candidates = []
  if (configuredFile !== '') candidates.push(resolve(expandHome(configuredFile)))
  candidates.push(join(dshHome(), 'secrets', 'mail-remote.pass'))
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8').trim()
    if (text !== '') return text
  }
  return ''
}

function asList(value) {
  if (value === undefined || value === null || value === '') return []
  const items = Array.isArray(value) ? value : String(value).split(',')
  return items
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => item !== '')
}

/**
 * Normalize a raw plugin config object into the runtime config the service consumes.
 * @param raw - loader row config (from cordis.patch.yml) or the CLI's JSON file.
 * @returns frozen, fully-defaulted config.
 */
/**
 * Loader passes volatile fields as reference objects with `.get()`. Unwrap them
 * (recursively) before normalizing, or every edit from the settings page would
 * be read as "[object Object]".
 */
export function unwrapConfig(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.get === 'function') return unwrapConfig(value.get())
  if (Array.isArray(value)) return value.map(unwrapConfig)
  const out = {}
  for (const [key, child] of Object.entries(value)) out[key] = unwrapConfig(child)
  return out
}

export function normalizeConfig(rawInput = {}) {
  const raw = unwrapConfig(rawInput)
  if (raw === null || typeof raw !== 'object') throw new Error('dsh-mail-remote: 配置必须是一个对象')
  const provider = String(raw.provider ?? 'qq').trim().toLowerCase()
  const preset = PROVIDER_PRESETS[provider]
  if (preset === undefined) {
    throw new Error(`dsh-mail-remote: 未知 provider ${JSON.stringify(provider)}；内置有 ${Object.keys(PROVIDER_PRESETS).join('/')}`)
  }

  const user = String(raw.user ?? '').trim()
  const allowFrom = asList(raw.allowFrom)
  const subjectToken = String(raw.subjectToken ?? '').trim()
  const enabled = asBool(raw.enabled, false)
  const password = readPassword(raw)

  if (enabled) {
    if (user === '') throw new Error('dsh-mail-remote: enabled=true 时必须配置 user（邮箱地址）')
    if (password === '') {
      throw new Error(
        'dsh-mail-remote: 找不到邮箱授权码。请设置 DSH_MAIL_REMOTE_PASSWORD 环境变量，或把授权码写进 passwordFile（默认 ~/.dsh/secrets/mail-remote.pass，权限 0600）',
      )
    }
    if (allowFrom.length === 0) throw new Error('dsh-mail-remote: enabled=true 时必须配置 allowFrom（允许的发件人精确地址）')
    if (subjectToken === '') throw new Error('dsh-mail-remote: enabled=true 时必须配置 subjectToken（主题口令）')
  }

  const permissionPreset = String(raw.permissionPreset ?? 'read-only').trim()
  if (!PERMISSION_PRESETS.has(permissionPreset)) {
    throw new Error(`dsh-mail-remote: permissionPreset 只能是 ${[...PERMISSION_PRESETS].join(' / ')}，收到 ${permissionPreset}`)
  }
  const approvalPolicy = String(raw.approvalPolicy ?? 'never').trim()
  if (!APPROVAL_POLICIES.has(approvalPolicy)) {
    throw new Error(`dsh-mail-remote: approvalPolicy 只能是 ask / never，收到 ${approvalPolicy}`)
  }

  const workdir = resolve(expandHome(raw.workdir ?? '~/DSH-Remote'))
  const stateFile = resolve(expandHome(raw.stateFile ?? join(dshHome(), 'mail-remote', 'state.json')))

  return Object.freeze({
    enabled,
    provider,
    user,
    password,
    imap: endpoint(raw.imap, preset.imap, 'imap'),
    smtp: endpoint(raw.smtp, preset.smtp, 'smtp'),
    mailbox: String(raw.mailbox ?? 'INBOX').trim() || 'INBOX',
    allowFrom,
    subjectToken,
    workdir,
    permissionPreset,
    approvalPolicy,
    agentPreset: String(raw.agentPreset ?? '').trim(),
    pollSeconds: asInt(raw.pollSeconds, 60, 'pollSeconds', 10, 3600),
    maxPerHour: asInt(raw.maxPerHour, 6, 'maxPerHour', 1, 60),
    maxBodyChars: asInt(raw.maxBodyChars, 4000, 'maxBodyChars', 200, 50000),
    replyEnabled: asBool(raw.replyEnabled, true),
    skipExisting: asBool(raw.skipExisting, true),
    dryRun: asBool(raw.dryRun, false),
    replyPrefix: String(raw.replyPrefix ?? '[DSH]').trim() || '[DSH]',
    stateFile,
  })
}

/** Short, secret-free description for logs and the check command. */
export function describeConfig(config) {
  const maskedUser = config.user.includes('@')
    ? `${config.user.slice(0, 2)}***@${config.user.split('@')[1]}`
    : config.user
  return {
    enabled: config.enabled,
    provider: config.provider,
    user: maskedUser,
    imap: `${config.imap.host}:${config.imap.port} secure=${config.imap.secure}`,
    smtp: `${config.smtp.host}:${config.smtp.port} secure=${config.smtp.secure}`,
    allowFrom: config.allowFrom,
    subjectToken: config.subjectToken,
    workdir: config.workdir,
    permissionPreset: config.permissionPreset,
    approvalPolicy: config.approvalPolicy,
    pollSeconds: config.pollSeconds,
    maxPerHour: config.maxPerHour,
    replyEnabled: config.replyEnabled,
    dryRun: config.dryRun,
    stateFile: config.stateFile,
    hasPassword: config.password !== '',
  }
}
