// 介面層測試：node tests/e2e-ui.test.js games/popquiz-showdown.html games/yushan-snap.html games/sweet-monster-snap.html
const path = require('path');
const { chromium } = require('playwright');
const { createEnv, run, post, get } = require('./gas-mock');

function seed() {
  const env = createEnv();
  env.props.SUPER_ADMIN_PASS = 'x';
  const c = env.ss.insertSheet('Configs');
  c.data.push(['roomCode', 'teacherPin', 'configJson', 'updatedAt', 'ownerPass', 'ownerName']);
  c.appendRow(["'12345", "'1", JSON.stringify({ title: 'T', classes: ['五年一班'], tasks: [
    { task: 'Q1', options: ['a', 'b', 'c', 'd'], answer: 2 }, { task: 'Q2', options: ['a', 'b', 'c', 'd'], answer: 1 }, { task: 'Q3', options: ['a', 'b', 'c', 'd'], answer: 3 }] }), new Date(), '', '']);
  run(env, 'setupSecurity');
  return env;
}

async function open(browser, env, file, opts) {
  const ctx = await browser.newContext(opts || { viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.protocol === 'file:') return route.continue();
    if (url.hostname === 'script.google.com') {
      const out = req.method() === 'POST' ? post(env, JSON.parse(req.postData() || '{}')) : get(env, Object.fromEntries(url.searchParams));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    }
    return route.fulfill({ status: 200, body: '' });
  });
  await page.goto('file://' + path.resolve(file));
  await page.waitForTimeout(700);
  return page;
}

async function runGame(browser, file) {
  const env = seed();
  const R = [];
  const check = (n, ok, d = '') => R.push({ n, ok: !!ok, d });

  const tv = await open(browser, env, file);
  await tv.evaluate(async () => { document.getElementById('tv-code-input').value = '12345'; await loadCloudQuizFromTv(); });
  await tv.waitForTimeout(400);

  const bar = await tv.evaluate(() => {
    const b = document.getElementById('snapui-toolbar');
    const r = b.getBoundingClientRect();
    const has = call => !!Array.from(b.querySelectorAll('[onclick]')).find(x => x.getAttribute('onclick').replace(/\s/g, '') === call);
    return {
      ids: ['tv-code-input', 'tv-class-select', 'tv-pair-display', 'tv-connection-pill'].every(id => b.contains(document.getElementById(id))),
      calls: ["stepQuestion(-1,'TV')", "revealCurrentAnswer('TV')", "stepQuestion(1,'TV')", 'toggleTvMaskMode()', 'toggleExplanationMode()', 'toggleTvSummaryView()', 'toggleTvFullscreen()'].every(has),
      bottom: Math.round(r.bottom), vh: innerHeight, rows: Math.round(r.height),
      scroll: document.documentElement.scrollHeight
    };
  });
  check('老師按鈕全部收進底部工具列', bar.ids && bar.calls, JSON.stringify(bar));
  check('1080p 畫面剛好填滿、不需捲動，工具列只有一排', bar.scroll <= bar.vh && bar.bottom <= bar.vh && bar.rows < 70, JSON.stringify(bar));

  // 鍵盤／簡報遙控器
  await tv.mouse.click(960, 300);
  await tv.keyboard.press('PageDown');
  await tv.waitForTimeout(300);
  const q1 = await tv.evaluate(() => currentQIndex);
  await tv.keyboard.press('ArrowLeft');
  await tv.waitForTimeout(300);
  const q0 = await tv.evaluate(() => currentQIndex);
  check('簡報遙控器 PageDown／方向鍵 可切換題目', q1 === 1 && q0 === 0, `${q1} → ${q0}`);
  await tv.evaluate(() => { for (let s = 1; s <= 5; s++) studentAnswers[s] = '2'; updateScoreBoard(true); });
  await tv.keyboard.press(' ');
  await tv.waitForTimeout(500);
  const locked = await tv.evaluate(() => !!(questionLockedState && questionLockedState[currentQIndex]));
  check('空白鍵公布正解', locked);

  // 在輸入框內打字不會觸發快捷鍵
  await tv.click('#tv-code-input');
  await tv.keyboard.press('ArrowRight');
  check('在輸入框內按方向鍵不會跳題', (await tv.evaluate(() => currentQIndex)) === 0);

  // 收起與記憶
  await tv.mouse.click(960, 300);
  await tv.keyboard.press('h');
  const collapsed = await tv.evaluate(() => document.body.classList.contains('snapui-collapsed') && getComputedStyle(document.getElementById('snapui-toolbar')).display === 'none');
  await tv.reload(); await tv.waitForTimeout(700);
  const remembered = await tv.evaluate(() => document.body.classList.contains('snapui-collapsed'));
  await tv.evaluate(() => document.querySelector('.snapui-handle').click());
  const reopened = await tv.evaluate(() => !document.body.classList.contains('snapui-collapsed'));
  check('H 鍵收起工具列，重新整理後記得，按右下角可展開', collapsed && remembered && reopened);

  // 畫布依顯示尺寸繪製（不被拉伸）
  await tv.waitForTimeout(400);
  const canvasOk = await tv.evaluate(() => Array.from(document.querySelectorAll('.snapui-fit-canvas')).every(c => Math.abs(c.width / c.height - c.clientWidth / c.clientHeight) < 0.02));
  check('遊戲畫布比例與顯示區一致（不變形）', canvasOk);
  check('大電視沒有 JavaScript 錯誤', tv.errors.length === 0, tv.errors.join(' | '));
  await tv.context().close();

  // ---------- 手機 ----------
  const phone = await open(browser, env, file, { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' });
  const gateBar = await phone.evaluate(() => document.querySelector('.snapui-mobile-bar').classList.contains('show'));
  check('未連線時不顯示底部操作列', !gateBar);
  await phone.evaluate(async () => { enableStandaloneMobileQuiz(); document.getElementById('challenge-code').value = '12345'; await loadCloudQuiz(); });
  await phone.waitForTimeout(700);
  const m = await phone.evaluate(() => {
    const bar = document.querySelector('.snapui-mobile-bar');
    const r = bar.getBoundingClientRect();
    return { show: bar.classList.contains('show'), bottom: Math.round(r.bottom), h: innerHeight, dupHidden: Array.from(document.querySelectorAll('#panel-scan .snapui-dup')).every(b => b.offsetParent === null) };
  });
  check('連線後底部固定顯示操作列，題目卡裡重複的按鈕隱藏', m.show && m.bottom === m.h && m.dupHidden, JSON.stringify(m));
  await phone.click('.snapui-m-next');
  await phone.waitForTimeout(300);
  check('手機「下一題」按鈕有效', (await phone.evaluate(() => currentQIndex)) === 1);
  await phone.evaluate(() => { for (let s = 1; s <= 3; s++) studentAnswers[s] = '1'; updateScoreBoard(true); });
  await phone.click('.snapui-m-reveal');
  await phone.waitForTimeout(400);
  check('手機「公布正解」按鈕有效', await phone.evaluate(() => !!questionLockedState[currentQIndex]));
  const upload = await phone.evaluate(() => { const b = Array.from(document.querySelectorAll('[onclick]')).find(x => x.getAttribute('onclick') === 'uploadClassSessionToGAS()'); return !!b && !!b.closest('.board-card'); });
  check('「結算並上傳」移到監控看板下方', upload);
  await phone.click('.snapui-settings-toggle');
  const folded = await phone.evaluate(() => getComputedStyle(document.querySelector('#mobile-active-quiz-zone .quiz-bar')).display === 'none');
  check('題庫與設定可以收合', folded);
  check('手機沒有 JavaScript 錯誤', phone.errors.length === 0, phone.errors.join(' | '));
  await phone.context().close();
  return R;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  let fail = 0;
  for (const f of process.argv.slice(2)) {
    console.log('\n■ ' + path.basename(f));
    for (const r of await runGame(browser, f)) { console.log(`  ${r.ok ? '✓' : '✗'} ${r.n}${r.ok ? '' : '  → ' + r.d}`); if (!r.ok) fail++; }
  }
  await browser.close();
  console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
  process.exitCode = fail ? 1 : 0;
})();
