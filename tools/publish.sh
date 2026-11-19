#!/usr/bin/env bash
# 把 games/ 裡的遊戲複製到各自 GitHub Pages 專案的 index.html。
# 用法：tools/publish.sh <放各遊戲專案 clone 的資料夾>
# 例如 tools/publish.sh ~/work  會更新 ~/work/popquiz-snap/index.html 等四個檔案（再到各資料夾 commit 與 push）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:?請指定放遊戲專案的資料夾}"
for g in popquiz-snap popquiz-showdown yushan-snap sweet-monster-snap; do
  if [ -d "$DEST/$g" ]; then cp "$ROOT/games/$g.html" "$DEST/$g/index.html"; echo "✓ $g"; else echo "略過 $g（找不到 $DEST/$g）"; fi
done
