import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

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
