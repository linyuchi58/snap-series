/* =====================================================================
   Snap UI 共用介面層（逆轉王／攀岩王／甜點派對）
   - 把大電視上的老師按鈕「搬」進底部工具列（元素本身與 onclick 完全不變）
   - 工具列可一鍵收起；支援簡報遙控器與鍵盤
   - 手機遙控端：底部固定操作列、連線後配對區縮小、設定區可收合
   設定：window.SNAPUI_CONFIG = { game, accent, accentInk, canvases: [選擇器] }
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.SNAPUI_CONFIG || {};
  const GAME = CFG.game || 'snap';
  const store = {
    get(k) { try { return localStorage.getItem('SNAPUI_' + GAME + '_' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('SNAPUI_' + GAME + '_' + k, v); } catch (e) {} }
  };
  const norm = s => String(s || '').replace(/\s+/g, '');
  function byClick(root, call, nth) {
    const list = Array.from((root || document).querySelectorAll('[onclick]')).filter(el => norm(el.getAttribute('onclick')) === norm(call));
    return list[nth || 0] || null;
  }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function readGlobal(name) { try { return (0, eval)('typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined'); } catch (e) { return undefined; } }
  function visible(node) { return !!node && node.offsetParent !== null; }

  if (CFG.accent) document.documentElement.style.setProperty('--snapui-accent', CFG.accent);
  if (CFG.accentInk) document.documentElement.style.setProperty('--snapui-accent-ink', CFG.accentInk);

  // ------------------------------------------------------------------
  // 大電視：底部老師工具列
  // ------------------------------------------------------------------
  function buildTvToolbar() {
    const panel = document.getElementById('panel-tv');
    const box = document.getElementById('tv-fullscreen-box');
    if (!panel || !box || document.getElementById('snapui-toolbar')) return;

    const pick = {
      code: document.getElementById('tv-code-input'),
      load: byClick(panel, 'loadCloudQuizFromTv()'),
      cls: document.getElementById('tv-class-select'),
      quizNo: document.getElementById('tv-auto-quiz-badge'),
      pair: document.getElementById('tv-pair-display'),
      qr: byClick(panel, 'openTvQrPairModal()'),
      newPair: byClick(panel, 'generateNewTvPairCode()'),
      conn: document.getElementById('tv-connection-pill'),
      mask: byClick(panel, 'toggleTvMaskMode()'),
      exp: byClick(panel, 'toggleExplanationMode()'),
      fever: byClick(panel, "toggleFeverRound('TV')"),
      board: byClick(panel, 'toggleRightBoardMode()'),
      summary: byClick(panel, 'toggleTvSummaryView()'),
      prev: byClick(panel, "stepQuestion(-1, 'TV')"),
      reveal: byClick(panel, "revealCurrentAnswer('TV')"),
      next: byClick(panel, "stepQuestion(1, 'TV')"),
      full: byClick(panel, 'toggleTvFullscreen()')
    };
    const formerParents = new Set();
    Object.values(pick).forEach(n => { if (n && n.parentElement) formerParents.add(n.parentElement); });

    const bar = el('div', 'snapui-toolbar'); bar.id = 'snapui-toolbar';
    const group = (cls, label, nodes) => {
      const g = el('div', 'snapui-group ' + cls);
      if (label) g.appendChild(el('span', 'snapui-label', label));
      nodes.filter(Boolean).forEach(n => {
        if (n.tagName === 'BUTTON') { n.removeAttribute('style'); n.classList.remove('btn-blue', 'btn-orange', 'btn-green', 'btn-purple'); n.removeAttribute('title'); }
        else if (n.style) { n.style.removeProperty('width'); n.style.removeProperty('padding'); n.style.removeProperty('font-size'); n.style.removeProperty('margin-left'); n.style.removeProperty('flex'); }
        g.appendChild(n);
      });
      return g;
    };
    if (pick.qr) pick.qr.textContent = '📱 QR';
    if (pick.newPair) pick.newPair.textContent = '🔄';
    if (pick.newPair) pick.newPair.title = '換一組配對碼';
    if (pick.load) pick.load.textContent = '載入';
    if (pick.full) pick.full.textContent = '⛶';
    if (pick.full) pick.full.title = '全螢幕（F）';
    if (pick.prev) { pick.prev.textContent = '◀ 上一題'; pick.prev.classList.add('snapui-step'); }
    if (pick.next) { pick.next.textContent = '下一題 ▶'; pick.next.classList.add('snapui-step'); }
    if (pick.reveal) { pick.reveal.classList.add('snapui-primary'); pick.reveal.title = '公布正解（空白鍵）'; }

    bar.appendChild(group('snapui-g-quiz', '題庫', [pick.code, pick.load, pick.cls, pick.quizNo]));
    bar.appendChild(group('snapui-g-pair', '手機配對', [pick.pair, pick.qr, pick.newPair, pick.conn]));
    bar.appendChild(group('snapui-g-nav', '', [pick.prev, pick.reveal, pick.next]));
    bar.appendChild(group('snapui-g-view', '顯示', [pick.mask, pick.exp, pick.fever, pick.board, pick.summary]));
    const sys = group('snapui-g-sys', '', [pick.full]);
    const keysBtn = el('button', 'snapui-btn', '?'); keysBtn.title = '鍵盤與簡報遙控器快捷鍵';
    const hideBtn = el('button', 'snapui-btn', '▾'); hideBtn.title = '收起工具列（H）';
    sys.appendChild(keysBtn); sys.appendChild(hideBtn);
    bar.appendChild(sys);
    box.appendChild(bar);

    const handle = el('button', 'snapui-handle', '⚙ 老師工具 <span style="opacity:.6">H</span>');
    box.appendChild(handle);
    const keys = el('div', 'snapui-keys',
      '<b>鍵盤／簡報遙控器</b><br>' +
      '<kbd>→</kbd><kbd>PgDn</kbd>下一題<br>' +
      '<kbd>←</kbd><kbd>PgUp</kbd>上一題<br>' +
      '<kbd>空白</kbd><kbd>Enter</kbd><kbd>B</kbd>公布正解<br>' +
      '<kbd>M</kbd>蓋牌　<kbd>E</kbd>解說　<kbd>S</kbd>總表<br>' +
      '<kbd>H</kbd>收起／展開工具列　<kbd>F</kbd>全螢幕');
    box.appendChild(keys);

    // 搬走按鈕之後，原本只剩標籤文字的外框就隱藏起來
    const hasControls = n => !!n.querySelector('[id], button, input, select, canvas, svg');
    formerParents.forEach(p => {
      let node = p;
      for (let i = 0; i < 4 && node && node !== box && node.id !== 'tv-quiz-view'; i++) {
        if (hasControls(node)) break;
        node.classList.add('snapui-hidden');
        node = node.parentElement;
      }
    });

    const setCollapsed = c => { document.body.classList.toggle('snapui-collapsed', c); store.set('collapsed', c ? '1' : '0'); keys.classList.remove('open'); fitCanvasesSoon(); };
    hideBtn.onclick = () => setCollapsed(true);
    handle.onclick = () => setCollapsed(false);
    keysBtn.onclick = () => keys.classList.toggle('open');
    setCollapsed(store.get('collapsed') === '1');

    // 按完工具列按鈕就移開焦點，避免空白鍵重複觸發
    bar.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTimeout(() => b.blur(), 0); });

    document.addEventListener('keydown', e => {
      if (!panel.classList.contains('active')) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      const press = n => { if (n) { e.preventDefault(); n.click(); } };
      if (k === 'ArrowRight' || k === 'PageDown') press(pick.next);
      else if (k === 'ArrowLeft' || k === 'PageUp') press(pick.prev);
      else if ((k === ' ' || k === 'Enter') && !(t && t.tagName === 'BUTTON')) press(pick.reveal);
      else if (k === 'b' || k === 'B' || k === '.') press(pick.reveal);
      else if (k === 'm' || k === 'M') press(pick.mask);
      else if (k === 'e' || k === 'E') press(pick.exp);
      else if (k === 's' || k === 'S') press(pick.summary);
      else if (k === 'f' || k === 'F') press(pick.full);
      else if (k === 'h' || k === 'H') { e.preventDefault(); setCollapsed(!document.body.classList.contains('snapui-collapsed')); }
      else if (k === '?') { e.preventDefault(); keys.classList.toggle('open'); }
    });
  }

  // ------------------------------------------------------------------
  // 畫布跟著顯示尺寸調整（遊戲每幀都讀 canvas.width / height 來排版）
  // ------------------------------------------------------------------
  const fitTargets = [];
  function setupCanvasFit() {
    (CFG.canvases || []).forEach(spec => {
      const sel = typeof spec === 'string' ? spec : spec.sel;
      const c = document.querySelector(sel);
      if (!c) return;
      c._snapuiMinH = (spec && spec.minHeight) || 0;
      c.classList.add('snapui-fit-canvas');
      if (c.parentElement) c.parentElement.classList.add('snapui-fit-host');
      fitTargets.push(c);
    });
    if (!fitTargets.length) return;
    const ro = window.ResizeObserver ? new ResizeObserver(fitCanvases) : null;
    fitTargets.forEach(c => ro ? ro.observe(c) : null);
    window.addEventListener('resize', fitCanvases);
    fitCanvases();
  }
  function fitCanvases() {
    fitTargets.forEach(c => {
      // 矮螢幕時以較大的邏輯尺寸繪製再縮小顯示，避免固定大小的圖案（城堡等）擠在一起
      let w = c.clientWidth, h = c.clientHeight;
      if (w < 50 || h < 50) return;
      const k = c._snapuiMinH && h < c._snapuiMinH ? c._snapuiMinH / h : 1;
      w = Math.round(w * k); h = Math.round(h * k);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    });
  }
  function fitCanvasesSoon() { setTimeout(fitCanvases, 30); setTimeout(fitCanvases, 250); }

  function measureHeader() {
    const nav = document.querySelector('.navbar');
    if (nav) document.documentElement.style.setProperty('--snapui-head', Math.ceil(nav.getBoundingClientRect().height) + 'px');
  }

  // ------------------------------------------------------------------
  // 手機遙控端
  // ------------------------------------------------------------------
  function buildMobile() {
    const panel = document.getElementById('panel-scan');
    if (!panel) return;
    const isPhone = () => window.matchMedia('(max-width: 820px)').matches;

    const orig = {
      prev: byClick(panel, "stepQuestion(-1, 'MOBILE')"),
      reveal: byClick(panel, "revealCurrentAnswer('MOBILE')"),
      next: byClick(panel, "stepQuestion(1, 'MOBILE')"),
      start: document.getElementById('btn-start-cam'),
      stop: document.getElementById('btn-stop-cam')
    };
    [orig.prev, orig.reveal, orig.next].forEach(b => b && b.classList.add('snapui-dup'));

    const bar = el('div', 'snapui-mobile-bar');
    const mk = (cls, html, fn) => { const b = el('button', cls, html); b.type = 'button'; b.onclick = fn; bar.appendChild(b); return b; };
    mk('snapui-m-prev', '◀<small>上一題</small>', () => orig.prev && orig.prev.click());
    mk('snapui-m-reveal', '公布正解', () => orig.reveal && orig.reveal.click());
    mk('snapui-m-next', '▶<small>下一題</small>', () => orig.next && orig.next.click());
    const cam = mk('snapui-m-cam off', '📷<small>開始掃描</small>', () => {
      if (readGlobal('scanning')) { orig.stop && orig.stop.click(); } else { orig.start && orig.start.click(); }
    });
    document.body.appendChild(bar);

    // 連線後的配對區：縮成一行，可再展開
    const gate = document.getElementById('mobile-pair-banner');
    if (gate && gate.firstElementChild) {
      const t = el('button', 'snapui-gate-toggle', '更換連線方式');
      t.type = 'button';
      t.onclick = () => gate.classList.toggle('snapui-open');
      gate.firstElementChild.appendChild(t);
    }

    // 題庫與設定：可收合（連線大電視時預設收起，題庫由大電視帶入）
    const zone = document.getElementById('mobile-active-quiz-zone');
    const quizBar = zone && zone.querySelector('.quiz-bar');
    let settingsToggle = null;
    if (quizBar) {
      settingsToggle = el('button', 'snapui-settings-toggle', '<span>⚙️ 題庫與設定</span><span class="snapui-caret">▾</span>');
      settingsToggle.type = 'button';
      quizBar.parentElement.insertBefore(settingsToggle, quizBar);
      settingsToggle.onclick = () => {
        const c = !zone.classList.contains('snapui-settings-collapsed');
        zone.classList.toggle('snapui-settings-collapsed', c);
        store.set('mobSettings', c ? 'closed' : 'open');
        settingsToggle.querySelector('.snapui-caret').textContent = c ? '▸' : '▾';
      };
      // 「結算並上傳」移到監控看板下方，收合設定時也找得到
      const upload = byClick(quizBar, 'uploadClassSessionToGAS()');
      const board = panel.querySelector('.board-card');
      if (upload && board) { const row = el('div', 'snapui-upload-row'); upload.removeAttribute('style'); row.appendChild(upload); board.appendChild(row); }
    }

    let lastPaired = null;
    setInterval(() => {
      const paired = !!readGlobal('isMobilePaired');
      const standalone = !!readGlobal('isStandaloneQuizMode');
      const connected = paired || standalone;
      document.body.classList.toggle('snapui-connected', connected);
      if (zone && settingsToggle && paired !== lastPaired) {
        const saved = store.get('mobSettings');
        const collapse = saved ? saved === 'closed' : paired;
        zone.classList.toggle('snapui-settings-collapsed', collapse);
        settingsToggle.querySelector('.snapui-caret').textContent = collapse ? '▸' : '▾';
        lastPaired = paired;
      }
      const show = isPhone() && panel.classList.contains('active') && visible(zone);
      bar.classList.toggle('show', show);
      document.body.classList.toggle('snapui-has-mobile-bar', show);
      const on = !!readGlobal('scanning');
      cam.classList.toggle('on', on); cam.classList.toggle('off', !on);
      cam.innerHTML = on ? '⏹<small>停止掃描</small>' : '📷<small>開始掃描</small>';
    }, 400);
  }

  function init() {
    measureHeader();
    buildTvToolbar();
    setupCanvasFit();
    buildMobile();
    window.addEventListener('resize', measureHeader);
    document.addEventListener('fullscreenchange', fitCanvasesSoon);
    fitCanvasesSoon();
  }
  if (document.readyState === 'complete') init(); else window.addEventListener('load', () => setTimeout(init, 0));
})();
