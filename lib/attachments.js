import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', '.dsh', '.cache', 'dist', 'build', '.npm-cache', '.pnpm-store'])

/**
 * Collect regular files under `root` touched at or after `sinceMs`, newest
 * first, bounded by count and total size. Hidden entries are skipped so a task
 * cannot exfiltrate dotfiles by merely touching them.
 * @param root - workspace directory to scan.
 * @param sinceMs - turn start timestamp; files older than this are ignored.
 * @param options - caps for the reply attachment list.
 * @returns array of { path, filename, size, mtimeMs }.
 */
export async function collectChangedFiles(root, sinceMs, options = {}) {
  const maxFiles = options.maxFiles ?? 5
  const maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024
  const maxTotalBytes = options.maxTotalBytes ?? 20 * 1024 * 1024
  const candidates = []

  const walk = async (dir) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }
      if (info.mtimeMs < sinceMs) continue
      if (info.size === 0 || info.size > maxFileBytes) continue
      candidates.push({ path: full, filename: basename(full), size: info.size, mtimeMs: info.mtimeMs })
    }
  }

  await walk(root)
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  const selected = []
  let total = 0
  for (const candidate of candidates) {
    if (selected.length >= maxFiles) break
    if (total + candidate.size > maxTotalBytes) continue
    selected.push(candidate)
    total += candidate.size
  }
  return selected
}

/**
 * Pull `[ATTACH: /abs/path]` markers out of an assistant reply.
 * @param text - final assistant text.
 * @returns cleaned text plus the absolute paths the model asked to attach.
 */
export function extractAttachmentMarkers(text) {
  const paths = []
  const cleaned = String(text ?? '').replace(/^[ \t]*\[attach:\s*([^\]\r\n]+)\][ \t]*$/gim, (_line, value) => {
    const path = String(value).trim()
    if (path !== '') paths.push(path)
    return ''
  })
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), paths }
}

/**
 * Validate explicit attachment paths against the allowed roots and size caps.
 * Paths outside the roots are rejected (so an email cannot ask the agent to
 * attach ~/.ssh or the DSH credentials store).
 */
export async function collectExplicitAttachments(paths, options = {}) {
  const roots = []
  for (const root of options.roots ?? []) {
    const absolute = resolve(root)
    try {
      roots.push(await realpath(absolute))
    } catch {
      roots.push(absolute)
    }
  }
  const maxFiles = options.maxFiles ?? 5
  const maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024
  const maxTotalBytes = options.maxTotalBytes ?? 20 * 1024 * 1024

  const inside = (target) => roots.some((root) => {
    const rel = relative(root, target)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })

  const selected = []
  let total = 0
  for (const input of paths) {
    if (selected.length >= maxFiles) break
    const raw = String(input).trim().replace(/^["']|["']$/g, '')
    if (raw === '' || !isAbsolute(raw)) continue
    let real
    try {
      real = await realpath(raw)
    } catch {
      continue
    }
    if (!inside(real)) continue
    let info
    try {
      info = await stat(real)
    } catch {
      continue
    }
    if (!info.isFile() || info.size === 0 || info.size > maxFileBytes) continue
    if (total + info.size > maxTotalBytes) continue
    selected.push({ path: real, filename: basename(real), size: info.size })
    total += info.size
  }
  return selected
}
