"""把 ui/snap-ui.css 與 ui/snap-ui.js 內嵌進三款遊戲（維持單一 HTML 檔）。可重複執行。
用法：python3 tools/build_ui.py
"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = (ROOT / "ui/snap-ui.css").read_text(encoding="utf-8")
JS = (ROOT / "ui/snap-ui.js").read_text(encoding="utf-8")

GAMES = {
    "popquiz-showdown.html": {"version": "v1.3.1", "config": {"game": "showdown", "accent": "#f97316", "accentInk": "#1c0a00", "canvases": [{"sel": "#race-track-canvas", "minHeight": 320}]}},
    "yushan-snap.html": {"version": "v1.4.1", "config": {"game": "yushan", "accent": "#fbbf24", "accentInk": "#1f1300", "canvases": []}},
    "sweet-monster-snap.html": {"version": "v1.2.1", "config": {"game": "sweet", "accent": "#f472b6", "accentInk": "#2a0717", "canvases": [{"sel": "#sweet-stage-canvas", "minHeight": 520}]}},
}
BEGIN, END = "<!-- SNAP-UI:BEGIN -->", "<!-- SNAP-UI:END -->"

for name, g in GAMES.items():
    path = ROOT / "games" / name
    src = path.read_text(encoding="utf-8")
    block = (f"{BEGIN}\n<style id=\"snap-ui-style\">\n{CSS}\n</style>\n"
             f"<script>window.SNAPUI_CONFIG = {json.dumps(g['config'], ensure_ascii=False)};</script>\n"
             f"<script id=\"snap-ui-script\">\n{JS}\n</script>\n{END}\n")
    if BEGIN in src:
        src = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", lambda m: block, src, flags=re.S)
    else:
        idx = src.rfind("</body>")
        src = src[:idx] + block + src[idx:]
    # 版號：APP_VERSION、<title>、導覽列徽章
    cur = re.search(r'const APP_VERSION = "([^"]+)";', src).group(1)
    v = g["version"]
    if cur != v:
        src = src.replace(f'const APP_VERSION = "{cur}";', f'const APP_VERSION = "{v}";', 1)
        src = re.sub(r"(<title>[^<]*\[)" + re.escape(cur) + r"([\] ])", r"\g<1>" + v + r"\g<2>", src, count=1)
    src = re.sub(r'(<span class="ver-badge">)[^<]*(</span>)', r"\g<1>" + v + r"\g<2>", src, count=1)
    path.write_text(src, encoding="utf-8")
    print("✓", name, v)
