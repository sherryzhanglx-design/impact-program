#!/usr/bin/env bash
# Encrypt the ITC page with the class code. Usage: ./build.sh path/to/plain.html
set -euo pipefail
cd "$(dirname "$0")"
SRC="${1:?plain html path}"
read -r -s -p "Class code: " CODE; echo
OUT="$(mktemp -d)"
npx staticrypt@3.5.4 "$SRC" -p "$CODE" -t itc_template.html --remember 30 --short -d "$OUT" \
  --template-title '看见我的隐形绳索' \
  --template-instructions 'IMPACT · Mindset 课堂练习。请输入老师在课上告诉你的课堂口令，它同时用于打开页面和使用 AI 教练。' \
  --template-placeholder '课堂口令' --template-button '进入练习' \
  --template-remember '在这台设备上记住（30 天）' --template-error '口令不对，请再核对一下。' \
  --template-toggle-show '显示口令' --template-toggle-hide '隐藏口令'
cp "$OUT/$(basename "$SRC")" ../../mindset-itc/index.html
rm -rf "$OUT" .staticrypt.json
echo "Encrypted page written to mindset-itc/index.html"
