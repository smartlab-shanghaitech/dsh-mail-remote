#!/usr/bin/env node
// Render the cordis.patch.yml row for mail-remote from a JSON config file.
// Used by scripts/install-desktop.sh; no personal values live here.
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (path === undefined) {
  console.error('usage: render-config-block.mjs <config.json>')
  process.exit(1)
}
const config = JSON.parse(readFileSync(path, 'utf8'))

const lines = []
lines.push('# dsh-mail-remote：由 scripts/install-desktop.sh 生成。')
lines.push('# 授权码建议放 0600 文件（passwordFile），不要写进本文件。')
lines.push('- id: mail-remote')
lines.push('  name: dsh-mail-remote')
lines.push('  config:')
lines.push(`    enabled: ${config.enabled === false ? 'false' : 'true'}`)
lines.push(`    provider: ${JSON.stringify(config.provider ?? 'qq')}`)
lines.push(`    user: ${JSON.stringify(config.user ?? '')}`)
if (config.passwordFile) lines.push(`    passwordFile: ${JSON.stringify(config.passwordFile)}`)
if (config.passwordEnv) lines.push(`    passwordEnv: ${JSON.stringify(config.passwordEnv)}`)
if (config.allowFrom) lines.push(`    allowFrom: ${JSON.stringify(config.allowFrom)}`)
if (config.subjectToken) lines.push(`    subjectToken: ${JSON.stringify(config.subjectToken)}`)
if (config.workdir) lines.push(`    workdir: ${JSON.stringify(config.workdir)}`)
if (config.workspaceName) lines.push(`    workspaceName: ${JSON.stringify(config.workspaceName)}`)
if (config.permissionPreset) lines.push(`    permissionPreset: ${JSON.stringify(config.permissionPreset)}`)
if (config.approvalPolicy) lines.push(`    approvalPolicy: ${JSON.stringify(config.approvalPolicy)}`)
if (config.pollSeconds !== undefined) lines.push(`    pollSeconds: ${Number(config.pollSeconds)}`)
if (config.maxPerHour !== undefined) lines.push(`    maxPerHour: ${Number(config.maxPerHour)}`)
if (config.replyEnabled !== undefined) lines.push(`    replyEnabled: ${config.replyEnabled === true}`)
if (config.attachChangedFiles !== undefined) lines.push(`    attachChangedFiles: ${config.attachChangedFiles === true}`)
if (config.skipExisting !== undefined) lines.push(`    skipExisting: ${config.skipExisting === true}`)
console.log(lines.join('\n'))
