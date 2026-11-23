/**
 * Declarative plugin config.
 *
 * DSH validates every loader-row config against this schema and the Settings
 * surface only exposes fields marked `.volatile()`; ordinary fields keep the
 * Loader lifecycle (edit through YAML). Secrets use `.role('secret')` so the
 * GUI never receives the stored value back.
 */
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  enabled: z.boolean().default(false).volatile().description('启用邮箱遥控'),
  provider: z.union(['qq', '163', '126']).default('qq').volatile().description('邮箱类型'),
  user: z.string().default('').volatile().description('收信/回信邮箱地址'),
  password: z.string().role('secret').default('').volatile().description('授权码（可选；留空则用文件或环境变量）'),
  passwordEnv: z.string().default('DSH_MAIL_REMOTE_PASSWORD'),
  passwordFile: z.string().default('').volatile().description('授权码文件路径'),
  allowFrom: z.array(z.string()).default([]).volatile().description('允许的发件人精确地址'),
  subjectToken: z.string().default('').volatile().description('主题口令，例如 [DSH-7f3a]'),
  workdir: z.string().default('~/DSH-Remote').volatile().description('新建会话的工作目录'),
  workspaceName: z.string().default('remote-dsh').volatile().description('GUI 中显示的工作区名称'),
  permissionPreset: z.union(['read-only', 'workspace-write']).default('workspace-write').volatile().description('会话权限档'),
  approvalPolicy: z.union(['ask', 'never']).default('never').volatile().description('审批策略（无人值守用 never）'),
  agentPreset: z.string().default(''),
  pollSeconds: z.number().step(1).min(10).max(3600).default(60).volatile().description('轮询间隔（秒）'),
  maxPerHour: z.number().step(1).min(1).max(60).default(6).volatile().description('每小时最多执行次数'),
  maxBodyChars: z.number().step(1).min(200).max(50000).default(4000),
  replyEnabled: z.boolean().default(true).volatile().description('执行后回信'),
  attachChangedFiles: z.boolean().default(true).volatile().description('把本次任务改动的文件作为附件回信'),
  maxAttachmentFiles: z.number().step(1).min(1).max(20).default(5).volatile().description('最多附件个数'),
  maxAttachmentBytes: z.number().step(1).min(1024).max(52428800).default(10485760).volatile().description('单个附件大小上限（字节）'),
  replyPrefix: z.string().default('[DSH]'),
  dryRun: z.boolean().default(false).volatile().description('只判定不执行、不回信'),
  mailbox: z.string().default('INBOX'),
  skipExisting: z.boolean().default(true).volatile().description('首次运行跳过历史邮件'),
  imap: z.any(),
  smtp: z.any(),
  stateFile: z.string().default(''),
})
