#!/bin/bash
# Install dsh-mail-remote into a DSH desktop profile, then write the plugin's
# configuration row into that profile's cordis.patch.yml.
#
# Personal values live in dev/config.local.json (gitignored) and never in this
# script. Environment overrides:
#   MAIL_REMOTE_CONFIG   default dev/config.local.json
#   DSH_BIN              default the macOS app's CLI
#   DSH_PROFILE_NAME     default desktop
#   DSH_PROFILE_DIR      default $HOME/.dsh/profiles/$DSH_PROFILE_NAME
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${MAIL_REMOTE_CONFIG:-$ROOT/dev/config.local.json}"
DSH="${DSH_BIN:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
PROFILE_NAME="${DSH_PROFILE_NAME:-desktop}"
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/$PROFILE_NAME}"
PATCH="$PROFILE_DIR/cordis.patch.yml"
PKG="$PROFILE_DIR/package.json"
BACKUP_DIR="$ROOT/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ -f "$CONFIG" ] || { echo "缺少 $CONFIG：先 cp dev/config.example.json dev/config.local.json 并填写"; exit 1; }
[ -x "$DSH" ] || { echo "找不到 DSH CLI：$DSH（可用 DSH_BIN 指定）"; exit 1; }
[ -f "$PATCH" ] || { echo "找不到 profile patch：$PATCH"; exit 1; }

mkdir -p "$BACKUP_DIR"
cp "$PATCH" "$BACKUP_DIR/cordis.patch.yml.$STAMP.bak"
cp "$PKG" "$BACKUP_DIR/package.json.$STAMP.bak"
echo "已备份到 $BACKUP_DIR"

if ! grep -q '"dsh-mail-remote"' "$PKG"; then
  echo "安装 dsh-mail-remote（本地目录）..."
  "$DSH" plugin --profile "$PROFILE_NAME" add "file:$ROOT"
else
  echo "profile 已含 dsh-mail-remote，跳过安装"
fi

BLOCK="$(node "$ROOT/scripts/render-config-block.mjs" "$CONFIG")"
python3 - "$PATCH" "$BLOCK" <<'PY'
import sys
path, block = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
if 'id: mail-remote' in text:
    print('cordis.patch.yml 已有 mail-remote 行，跳过写入')
elif text.strip() in ('', '[]'):
    open(path, 'w', encoding='utf-8').write(block + '\n')
    print('已写入 mail-remote 配置（替换空模板）')
else:
    open(path, 'a', encoding='utf-8').write('\n' + block + '\n')
    print('已追加 mail-remote 配置')
PY

cd "$PROFILE_DIR"
node -e "const YAML=require('yaml'),fs=require('fs');const a=YAML.parse(fs.readFileSync(process.argv[1],'utf8'));if(!Array.isArray(a))throw new Error('patch must be an array');console.log('YAML OK, entries =',a.length)" "$PATCH"

echo "完成。重启 DSH 或等 HMR 重载后，插件开始按配置轮询。"
