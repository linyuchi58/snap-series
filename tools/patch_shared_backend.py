"""共用後端：逆轉王改連攀岩王／甜點派對的後端，並讓每筆成績記下遊戲名稱。
用法：python3 tools/patch_shared_backend.py <檔案.html> <遊戲短名> <舊版號> <新版號>
"""
import re
import sys

path, game_label, old_ver, new_ver = sys.argv[1:5]
src = open(path, encoding="utf-8").read()

SHARED_URL = "https://script.google.com/macros/s/AKfycbwldbgt8JrFwbP4GbaMR-ICgWrdY6N7flmilKvXOI-rudwwfLUMu3b5NCL-KWofiL85/exec"
OLD_SHOWDOWN_URL = "https://script.google.com/macros/s/AKfycbzoaZ--EPlQJ49p8EtgKDH5cbNg4DA6YXiVvL2Q2vQMe69ubfVZc46-OVh2UIZgPg/exec"


def func_span(text, name):
    m = re.search(r"\n([ \t]*(?:async\s+)?function\s+" + name + r"\s*\()", text)
    i = text.index("{", m.end())
    depth, j = 0, i
    while True:
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return m.start() + 1, j + 1


def sub_n(text, pattern, repl, label, count=1):
    new, n = re.subn(pattern, repl, text)
    if n != count:
        raise SystemExit(f"[{label}] 預期命中 {count} 次，實際 {n} 次")
    return new


def in_func(text, name, pattern, repl, label, count=1):
    a, b = func_span(text, name)
    return text[:a] + sub_n(text[a:b], pattern, repl, label, count) + text[b:]


# 1. 每筆成績的 rankTitle 第 7 段記錄遊戲名稱
src = sub_n(src, r"(\|\|\$\{studentTotalQ\})`", r"\1||" + game_label + "`", "rank-game")
src = sub_n(src, r"(\n[ \t]*)const APP_VERSION = ", r"\1const GAME_LABEL = '" + game_label + r"';\1const APP_VERSION = ", "label-const")
src = in_func(src, "unpackLogRecord", r"return Object\.assign\(\{\}, r, \{",
              'return Object.assign({}, r, { gameName: String(r.rankTitle || "").split("||")[6] || "",', "unpack-game")

# 2. 教師後台：場次欄位下方顯示遊戲名稱；CSV 多一欄
GAME_TAG = "${r.gameName ? '<div style=\"font-size:11px;color:#636e72;font-weight:normal;\">' + escapeHtml(r.gameName) + '</div>' : ''}"
src = in_func(src, "renderTeacherTable", r"\$\{escapeHtml\(r\.quizNo\)\}</td>", "${escapeHtml(r.quizNo)}" + GAME_TAG.replace("\\", "\\\\") + "</td>", "table-game", count=2)
src = in_func(src, "exportRecordsCSV", r"單元名稱,錯題診斷明細\\n", r"單元名稱,錯題診斷明細,遊戲\\n", "csv-head")
src = in_func(src, "exportRecordsCSV", r'"\$\{r\.wrongDetails\}"\\n`', r'"${r.wrongDetails}","${r.gameName || ""}"\\n`', "csv-row")

# 3. 逆轉王：改用共用後端；瀏覽器裡若存著舊網址，自動換成新網址
if OLD_SHOWDOWN_URL in src:
    src = sub_n(src, re.escape(f'DEFAULT_GAS_URL = "{OLD_SHOWDOWN_URL}"'), f'DEFAULT_GAS_URL = "{SHARED_URL}"', "showdown-url")
    src = in_func(src, "getGasUrl", r"(const saved = localStorage\.getItem\('POPQUIZ_SHOWDOWN_GAS_URL'\);)",
                  r"\1\n            if (saved === '" + OLD_SHOWDOWN_URL + r"') { localStorage.setItem('POPQUIZ_SHOWDOWN_GAS_URL', DEFAULT_GAS_URL); return DEFAULT_GAS_URL; }",
                  "showdown-migrate")

src = sub_n(src, r'const APP_VERSION = "' + re.escape(old_ver) + '";', f'const APP_VERSION = "{new_ver}";', "version")
src = sub_n(src, r"(<title>[^<]*\[)" + re.escape(old_ver) + r"([\] ])", r"\g<1>" + new_ver + r"\g<2>", "title")
open(path, "w", encoding="utf-8").write(src)
print("✓", path)
