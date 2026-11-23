#!/bin/bash
# Dev helper: hardlink the working tree's plugin files into a profile's installed
# copy (pnpm `file:` installs hardlinks, so edits to existing files are already
# shared, but newly added files and package.json changes are not).
# Usage: scripts/sync-profile-copy.sh ~/.dsh/profiles/desktop/node_modules/dsh-mail-remote
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:?usage: sync-profile-copy.sh <installed-copy-dir>}"

mkdir -p "$TARGET/lib"
for file in lib/*.js; do
  dest="$TARGET/$file"
  rm -f "$dest"
  ln "$ROOT/$file" "$dest"
done
for file in package.json cordis.patch.yml README.md; do
  if [ -f "$ROOT/$file" ]; then
    rm -f "$TARGET/$file"
    ln "$ROOT/$file" "$TARGET/$file"
  fi
done
echo "synced $ROOT -> $TARGET"
ls "$TARGET/lib"
