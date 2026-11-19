"""階段一前端修補：讓四款遊戲配合 Code.gs v3.1。
用法：python3 tools/patch_phase1.py <輸入.html> <輸出.html> <舊版號> <新版號>
每一處修改都必須「剛好命中」預期次數，否則中止，避免默默改錯地方。
"""
import re
import sys

src_path, out_path, old_ver, new_ver = sys.argv[1:5]
src = open(src_path, encoding="utf-8").read()


def func_span(text, name):
    m = re.search(r"\n([ \t]*(?:async\s+)?function\s+" + name + r"\s*\()", text)
    if not m:
        raise SystemExit(f"找不到函式 {name}")
    i = text.index("{", m.end())
    depth, j = 0, i
    while True:
        ch = text[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return m.start() + 1, j + 1


def replace_once(text, old, new, label, count=1):
    n = text.count(old)
    if n != count:
        raise SystemExit(f"[{label}] 預期命中 {count} 次，實際 {n} 次")
    return text.replace(old, new)


def edit_in_func(text, name, fn, label):
    a, b = func_span(text, name)
    body = text[a:b]
    new_body = fn(body)
    if new_body == body:
        raise SystemExit(f"[{label}] 沒有任何改動")
    return text[:a] + new_body + text[b:]


def replace_func(text, name, new_code):
    a, b = func_span(text, name)
    indent = re.match(r"[ \t]*", text[a:]).group(0)
    return text[:a] + indent + new_code.strip() + text[b:]


POST = "method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }"

# 1. 快速進入我的代碼：不再傳遞（也拿不到）管理密碼，改由後端以建立者通行碼驗證
src = replace_once(src, "quickEnterMyRoom('${r.roomCode}', '${r.roomPin}')", "quickEnterMyRoom('${r.roomCode}')", "quick-chip")
src = replace_func(src, "quickEnterMyRoom", """
        async function quickEnterMyRoom(code) {
            document.getElementById('maintain-room-code-input').value = code;
            document.getElementById('maintain-room-pin-input').value = '';
            await submitMaintainRoom();
        }""")
src = edit_in_func(src, "submitMaintainRoom", lambda b: replace_once(b, "data.roomPin || pin", "pin", "maintain"), "maintain")

# 2. 清空成績：附上教師通行碼，並依後端結果顯示訊息
src = replace_func(src, "executeClearRoomRecords", f"""
        async function executeClearRoomRecords() {{
            if (!confirm(`確定要永久清空代碼 [${{adminSession.roomCode}}] 的所有成績紀錄嗎？`)) return;
            try {{
                const res = await fetch(getGasUrl(), {{ {POST}, body: JSON.stringify({{ action: "clearRoomScores", roomCode: adminSession.roomCode, teacherPin: adminSession.roomPin || "", teacherPass: adminSession.teacherPass || "" }}) }});
                const data = await res.json();
                showToast((data && data.message) || '❌ 清空失敗');
                if (data && data.status === 'success') fetchTeacherRecords();
            }} catch (e) {{ showToast('❌ 連線失敗，紀錄未清空'); }}
        }}""")

# 3. 教師後台讀取成績：改用需驗證的 POST
GET_RECORDS = "fetch(`${getGasUrl()}?action=getTeacherRecords&roomCode=${encodeURIComponent(code)}`)"
POST_RECORDS = f'fetch(getGasUrl(), {{ {POST}, body: JSON.stringify({{ action: "getTeacherRecords", roomCode: code, teacherPin: adminSession.roomPin || "", teacherPass: adminSession.teacherPass || "" }}) }})'


def fix_records(b):
    b = replace_once(b, GET_RECORDS, POST_RECORDS, "records-fetch")
    return replace_once(b, "await res.json();", "await res.json();\n                if (!data || data.status !== 'success') { summaryEl.textContent = (data && data.message) || '❌ 讀取失敗'; return; }", "records-check")


src = edit_in_func(src, "fetchTeacherRecords", fix_records, "records")

# 4. 推算下一個場次：改用只回傳場次清單的 getQuizSessions，並只採用最後一次請求的結果
src = replace_func(src, "detectNextQuizNumberForClass", """
        async function detectNextQuizNumberForClass(className) {
            const mySeq = ++quizNoRequestSeq;
            const code = (document.getElementById('challenge-code').value.trim() || "00000").padStart(5, '0');
            let next = "測驗一";
            try {
                const res = await fetch(`${getGasUrl()}?action=getQuizSessions&roomCode=${encodeURIComponent(code)}`);
                const data = await res.json();
                if (data && data.status === 'success' && Array.isArray(data.sessions)) {
                    const used = new Set(data.sessions.filter(s => s.className === className && s.quizNo).map(s => s.quizNo));
                    next = `測驗${CN_NUMS[used.size] || (used.size + 1)}`;
                }
            } catch (e) {}
            if (mySeq !== quizNoRequestSeq) return;
            currentQuizNoStr = next;
            updateQuizBadgesUI();
        }""")
src = replace_once(src, "        async function detectNextQuizNumberForClass(", "        let quizNoRequestSeq = 0;\n        async function detectNextQuizNumberForClass(", "quiz-seq")

# 5. 上傳成績：確認後端真的寫入成功（以前 GAS 出錯也會顯示「成功儲存」）
up_re = re.compile(r"await fetch\(getGasUrl\(\), \{\s*method: 'POST',\s*headers: \{ 'Content-Type': 'text/plain;charset=utf-8' \},\s*body: JSON\.stringify\(\{ action: \"submitBatchScores\", roomCode: code, records: batchRecords \}\)\s*\}\);")


def fix_upload(b):
    b2, n = up_re.subn(
        f'const upRes = await fetch(getGasUrl(), {{ {POST}, body: JSON.stringify({{ action: "submitBatchScores", roomCode: code, records: batchRecords, wantLeaderboard: false }}) }});\n'
        "                const upData = await upRes.json();\n"
        "                if (!upData || upData.status !== 'success') { showToast((upData && upData.message) || '❌ 上傳失敗，請稍後再試'); return; }",
        b)
    if n != 1:
        raise SystemExit(f"[upload] 預期命中 1 次，實際 {n} 次")
    return b2


src = edit_in_func(src, "uploadClassSessionToGAS", fix_upload, "upload")

# 6. 儲存題庫：失敗時顯示後端的原因；題庫內不再夾帶管理密碼
src = replace_once(src, "params.roomPin = adminSession.roomPin;", "delete params.roomPin;", "save-pin")
src = edit_in_func(src, "saveRoomConfigToCloud", lambda b: replace_once(b, "const data = await res.json();", "const data = await res.json();\n                if (!data || data.status !== 'success') { showToast((data && data.message) || '❌ 雲端儲存失敗'); return; }", "save-check"), "save")
src = edit_in_func(src, "submitCreateRoom", lambda b: re.sub(r"\s*defaultCfg\.roomPin = pin;", "", b), "create")

# 7. 版號
src = replace_once(src, f'const APP_VERSION = "{old_ver}";', f'const APP_VERSION = "{new_ver}";', "version")
src = re.sub(r"(<title>[^<]*\[)" + re.escape(old_ver) + r"([\] ])", r"\g<1>" + new_ver + r"\g<2>", src, count=1)
if f"[{new_ver}" not in src:
    raise SystemExit("[title] 版號沒有更新")

open(out_path, "w", encoding="utf-8").write(src)
print(f"✓ {out_path}")
