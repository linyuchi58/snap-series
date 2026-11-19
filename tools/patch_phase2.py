"""階段二前端修補：教室實際會遇到的穩定性問題。
用法：python3 tools/patch_phase2.py <檔案.html> <舊版號> <新版號>（直接覆寫該檔）
每一處修改都必須剛好命中預期次數，否則中止。光學引擎、字典、折紙卡角度一律不動。
"""
import re
import sys

path, old_ver, new_ver = sys.argv[1:4]
src = open(path, encoding="utf-8").read()
applied = []


def func_span(text, name):
    m = re.search(r"\n([ \t]*(?:async\s+)?function\s+" + name + r"\s*\()", text)
    if not m:
        return None
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


def sub_n(text, pattern, repl, label, count=1, flags=0):
    new, n = re.subn(pattern, repl, text, flags=flags)
    if n != count:
        raise SystemExit(f"[{label}] 預期命中 {count} 次，實際 {n} 次")
    applied.append(label)
    return new


def in_func(text, name, pattern, repl, label, count=1):
    span = func_span(text, name)
    if not span:
        raise SystemExit(f"[{label}] 找不到函式 {name}")
    a, b = span
    return text[:a] + sub_n(text[a:b], pattern, repl, label, count) + text[b:]


# ---------------------------------------------------------------------------
# 1. 後台分數：未作答的題目要算進分母（以前缺答的學生在後台分數會虛高）
#    新紀錄在 rankTitle 第 6 段寫入施測題數；舊紀錄用「題數×15 秒」反推
# ---------------------------------------------------------------------------
src = sub_n(src, r"(rankTitle: `\$\{rankBadge\}\|\|\$\{topicStr\}\|\|\$\{wrongStr\}\|\|\$\{className\}\|\|\$\{quizNo\})`",
            r"\1||${studentTotalQ}`", "rankTitle-totalQ")
src = in_func(src, "unpackLogRecord", r"(\n[ \t]*)return Object\.assign\(\{\}, r, \{",
              r"\1finalScore = snapScoreFromRecord(r, cCnt, wCnt, finalScore);\1return Object.assign({}, r, {", "unpack-score")
src = sub_n(src, r"(\n[ \t]*)function unpackLogRecord\(", r"""\1// 舉牌系列的百分制：分母是「本場施測題數」，沒作答的題目也算在內
\1function snapScoreFromRecord(r, cCnt, wCnt, fallback) {
\1    const parts = String(r.rankTitle || "").split("||");
\1    let totalQ = Number(parts[5]) || 0;
\1    const dur = Number(r.durationSeconds) || 0;
\1    if (!totalQ && dur > 0 && dur % 15 === 0) totalQ = dur / 15;
\1    totalQ = Math.max(totalQ, cCnt + wCnt);
\1    return totalQ > 0 ? Math.round((cCnt / totalQ) * 100) : fallback;
\1}
\1function unpackLogRecord(""", "score-helper")

# ---------------------------------------------------------------------------
# 2. 雙機同步：手機（或電腦）重新整理後序號從頭算，對方要能認出「這是新的一次連線」
# ---------------------------------------------------------------------------
src = sub_n(src, r"(\n([ \t]*)let [^\n]*lastSeenMobSeq = -1;)",
            r"\1\n\2const CLIENT_SESSION_ID = Math.random().toString(36).slice(2, 10);\n\2let lastSeenMobSid = '', lastSeenTvSid = '';",
            "sid-vars")
src = in_func(src, "pushTvMailboxToCloud", r"updatedAt: Date\.now\(\)", "sid: CLIENT_SESSION_ID, updatedAt: Date.now()", "sid-tv")
src = in_func(src, "pushMobileMailboxToCloud", r"updatedAt: Date\.now\(\)", "sid: CLIENT_SESSION_ID, updatedAt: Date.now()", "sid-mob")
src = in_func(src, "startTvPolling", r"if \(typeof mbLive\.mobSeq === 'number'",
              "if (mbLive.sid && mbLive.sid !== lastSeenMobSid) { lastSeenMobSid = mbLive.sid; lastSeenMobSeq = -1; }\n                        if (typeof mbLive.mobSeq === 'number'", "sid-tv-poll")
src = in_func(src, "startMobilePolling", r"if \(typeof tvLive\.tvSeq === 'number'",
              "if (tvLive.sid && tvLive.sid !== lastSeenTvSid) { lastSeenTvSid = tvLive.sid; lastSeenTvSeq = -1; }\n                        if (typeof tvLive.tvSeq === 'number'", "sid-mob-poll")
src = in_func(src, "connectMobileToTv", r"lastSeenTvSeq = tvLive\.tvSeq \|\| 0;",
              "lastSeenTvSeq = tvLive.tvSeq || 0; lastSeenTvSid = tvLive.sid || '';", "sid-connect")

# 3. 「讓大電視跟隨手機」時，手機不再寫入大電視的信箱（違反雙信箱原則，會留下舊狀態）
src = in_func(src, "resolveQuestionMismatch", r"pushTvMailboxToCloud\(false\);\s*", "", "no-mobile-write-tv")

# ---------------------------------------------------------------------------
# 4. 配對碼：只產生「鏡頭掃得到、不會和學生卡重疊、轉向也不會讀成別的碼」的號碼
# ---------------------------------------------------------------------------
src = in_func(src, "generateNewTvPairCode", r"activePairCode = String\(Math\.floor\(1000 \+ Math\.random\(\) \* 9000\)\);",
              "activePairCode = pickOpticalSafePairCode();", "safe-pair")
src = sub_n(src, r"(\n[ \t]*)async function generateNewTvPairCode\(", r"""\1function pickOpticalSafePairCode() {
\1    for (let attempt = 0; attempt < 500; attempt++) {
\1        const s = String(Math.floor(1000 + Math.random() * 9000));
\1        const code = encodePairCodeTo16Bits(s), dots = popcount16(code);
\1        if (dots < 5 || dots > 11) continue;
\1        let ok = true, r = code;
\1        for (let k = 1; k < 4 && ok; k++) { r = rotate16BitsCW(r); const d = decode16BitsToPairCode(r); if (d && d !== s) ok = false; }
\1        if (ok) ok = !MARKER_CODES.some(m => { let t = m; for (let k = 0; k < 4; k++) { if (t === code) return true; t = rotate16BitsCW(t); } return false; });
\1        if (ok) return s;
\1    }
\1    return String(Math.floor(1000 + Math.random() * 9000));
\1}
\1async function generateNewTvPairCode(""", "safe-pair-fn")

# ---------------------------------------------------------------------------
# 5. 小班：人數下限 10 → 1（偏鄉小校常有 5~9 人的班）
# ---------------------------------------------------------------------------
src = in_func(src, "updateClassSize", r"Math\.max\(10, Math\.min\(100,", "Math.max(1, Math.min(100,", "class-min")
src = sub_n(src, r'(id="(?:slider|set)-class-size" )min="10"', r'\1min="1"', "class-min-html", count=2)

# ---------------------------------------------------------------------------
# 6. 重複上傳：同一份作答再按一次上傳要先確認
# ---------------------------------------------------------------------------
src = in_func(src, "uploadClassSessionToGAS", r"updateRecordedQuestionCounter\(\);",
              "updateRecordedQuestionCounter();\n            const uploadSig = JSON.stringify([getActiveClassName(), questionAnswersMemory, questionLockedState]);\n"
              "            if (uploadSig === lastUploadSignature && !confirm('這一場的成績已經上傳過了，確定要再上傳一次嗎？（會產生重複紀錄）')) return;",
              "dup-check")
src = in_func(src, "uploadClassSessionToGAS", r"(if \(!upData \|\| upData\.status !== 'success'\) \{[^\n]*\})",
              r"\1\n                lastUploadSignature = uploadSig;", "dup-mark")
src = sub_n(src, r"(\n[ \t]*)async function uploadClassSessionToGAS\(", r"\1let lastUploadSignature = '';\1async function uploadClassSessionToGAS(", "dup-var")

# ---------------------------------------------------------------------------
# 7. 相機：離開掃描分頁或切到背景就關閉；避免同時開兩次；iPad 同一張照片可以重選
# ---------------------------------------------------------------------------
src = in_func(src, "switchTab", r"^(\s*function switchTab\(tab\) \{)",
              r"\1\n            if (tab !== 'scan' && scanning) stopCamera();", "cam-tab")
src = in_func(src, "handleNativeCameraSnap", r"(const f = e\.target\.files && e\.target\.files\[0\];)", r"\1 e.target.value = '';", "ipad-reselect")

# ---------------------------------------------------------------------------
# 8. 列印預覽：以前一開網頁就畫 28 張全尺寸大圖（約 400 MB），手機會當掉
#    改為進入列印分頁才畫，每張縮成預覽尺寸；PDF 與列印仍用全尺寸
# ---------------------------------------------------------------------------
span = func_span(src, "renderPrintCards")
if span:
    a, b = span
    old = src[a:b]
    m = re.search(r"pageCanvas\.width = (\d+); pageCanvas\.height = (\d+);", old)
    if not m:
        raise SystemExit("[print] 找不到列印畫布尺寸")
    fw, fh = int(m.group(1)), int(m.group(2))
    tw = 560
    th = round(tw * fh / fw)
    new = f"""        async function renderPrintCards() {{
            const s = parseInt(document.getElementById('slider-print-start').value) || 1;
            const e = parseInt(document.getElementById('slider-print-end').value) || 28;
            const c = document.getElementById('print-cards-container'); if (!c) return;
            const key = s + '-' + e;
            if (c.dataset.rendered === key && c.children.length) return;
            const token = (renderPrintCards._token = (renderPrintCards._token || 0) + 1);
            c.dataset.rendered = key;
            c.innerHTML = '';
            const work = document.createElement('canvas'); work.width = {fw}; work.height = {fh};
            const previewEnd = Math.min(e, s + 29);
            for (let i = s; i <= previewEnd; i++) {{
                if (token !== renderPrintCards._token) return;
                drawOrigamiA4SheetCanvas(work, i);
                const thumb = document.createElement('canvas'); thumb.width = {tw}; thumb.height = {th};
                thumb.getContext('2d').drawImage(work, 0, 0, {tw}, {th});
                const sh = document.createElement('div'); sh.className = 'fold-sheet';
                sh.appendChild(thumb); c.appendChild(sh);
                await new Promise(r => setTimeout(r, 0));
            }}
            work.width = work.height = 0;
        }}"""
    src = src[:a] + new + src[b:]
    applied.append("print-lazy")
    src = sub_n(src, r"\n[ \t]*renderPrintCards\(\);(?=\s*\n[ \t]*renderSettingsTable\(\);|\s*\n)", "", "print-no-onload", count=1)
    src = in_func(src, "switchTab", r"(if \(tab !== 'scan' && scanning\) stopCamera\(\);)",
                  r"\1\n            if (tab === 'print') renderPrintCards();", "print-on-tab")

# ---------------------------------------------------------------------------
# 9. 甜點派對：舞台動畫只在大電視分頁可見時才繪製（以前手機掃描時也在背景狂畫）
# ---------------------------------------------------------------------------
if "function initSweetStageLoop()" in src:
    src = sub_n(src, r"(function renderFrame\(nowMs\) \{)",
                r"\1\n                const tvPanelEl = document.getElementById('panel-tv');\n"
                r"                if (document.hidden || !tvPanelEl || !tvPanelEl.classList.contains('active')) { requestAnimationFrame(renderFrame); return; }",
                "sweet-idle")

# ---------------------------------------------------------------------------
# 10. 全域：iOS 音效解鎖、避免重複開相機、切到背景時關閉相機
# ---------------------------------------------------------------------------
GLOBAL = """
        // ===== v2 階段二：全域穩定性補強 =====
        (function () {
            const rawStartCamera = startCamera;
            let cameraStarting = false;
            startCamera = async function () {
                if (scanning || cameraStarting) return;
                cameraStarting = true;
                try { await rawStartCamera(); } finally { cameraStarting = false; }
            };
            document.addEventListener('pointerdown', function () {
                try {
                    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    if (audioCtx.state === 'suspended') audioCtx.resume();
                } catch (e) {}
            }, { once: true, capture: true });
            document.addEventListener('visibilitychange', function () {
                if (document.hidden && scanning) { stopCamera(); showToast('📷 已暫停相機（畫面切到背景），回來後請再按「開始掃描」'); }
            });
        })();
"""
idx = src.rfind("\n    </script>")
if idx < 0:
    raise SystemExit("[global] 找不到主程式的結尾")
src = src[:idx] + GLOBAL + src[idx:]
applied.append("global")

# 版號
src = sub_n(src, r'const APP_VERSION = "' + re.escape(old_ver) + '";', f'const APP_VERSION = "{new_ver}";', "version")
src = sub_n(src, r"(<title>[^<]*\[)" + re.escape(old_ver) + r"([\] ])", r"\g<1>" + new_ver + r"\g<2>", "title")

open(path, "w", encoding="utf-8").write(src)
print(f"✓ {path}：{len(applied)} 項 → {', '.join(applied)}")
