// 階段二端對端測試：node tests/e2e-phase2.test.js games/popquiz-snap.html [...]
// 大電視與手機各開一個瀏覽器分頁，共用同一個模擬後端。
const path = require('path');
const { chromium } = require('playwright');
const { createEnv, run, post, get } = require('./gas-mock');

function seed() {
  const env = createEnv();
  env.props.AUTH_HUB_SPREADSHEET_ID = 'HUB_ID';
  env.props.SUPER_ADMIN_PASS = 'New-Super-Pass-2026';
  env.hub.sheets.Users.data.push(['TeacherA', '王老師', '', '', 'FRIEND', 5, 'ACTIVE', '永久有效']);
  const cfgs = env.ss.insertSheet('Configs');
  cfgs.data.push(['roomCode', 'teacherPin', 'configJson', 'updatedAt', 'ownerPass', 'ownerName']);
  cfgs.appendRow(["'12345", "'1234", JSON.stringify({ title: '測試', classes: ['五年一班'], tasks: [
    { task: 'Q1', options: ['a', 'b', 'c', 'd'], answer: 1 }, { task: 'Q2', options: ['a', 'b', 'c', 'd'], answer: 1 }] }), new Date(), "'TeacherA", '王老師']);
  const s = env.ss.insertSheet('Scores_1');
  s.data.push(['timestamp', 'roomCode', 'seatNo', 'playerName', 'score', 'correctCount', 'wrongCount', 'maxCombo', 'durationSeconds', 'rankTitle']);
  // 一筆 v2.8.6 上傳的舊紀錄：施測 4 題、只答 2 題且全對 → 正確應為 50 分（舊版後台會算成 100）
  s.appendRow(['2026-11-01 10:00:00', "'12345", "'09", '五年一班_09號 (測驗一)', 50, 2, 0, 2, 60, '🌱||測試||全對無失誤||五年一班||測驗一']);
  run(env, 'setupSecurity');
  return env;
}

async function openPage(browser, env, file, mobile) {
  const ctx = await browser.newContext(mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', viewport: { width: 390, height: 844 } } : {});
  const page = await ctx.newPage();
  page.errors = [];
  page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => { page.dialogs.push(d.message()); (page.dialogPolicy || (() => d.accept()))(d); });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.protocol === 'file:') return route.continue();
    if (url.hostname === 'script.google.com') {
      const out = req.method() === 'POST' ? post(env, JSON.parse(req.postData() || '{}')) : get(env, Object.fromEntries(url.searchParams));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    }
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.goto('file://' + path.resolve(file));
  await page.waitForTimeout(700);
  return page;
}

async function runGame(browser, file) {
  const env = seed();
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
  const hasPrint = await (async () => require('fs').readFileSync(file, 'utf8').includes('function renderPrintCards'))();

  // ---------- 大電視 ----------
  const tv = await openPage(browser, env, file, false);
  const pair = await tv.evaluate(() => activePairCode);
  const pairSafe = await tv.evaluate(() => {
    const c = encodePairCodeTo16Bits(activePairCode), n = popcount16(c);
    let r = c, ok = n >= 5 && n <= 11;
    for (let k = 1; k < 4; k++) { r = rotate16BitsCW(r); const d = decode16BitsToPairCode(r); if (d && d !== activePairCode) ok = false; }
    return ok;
  });
  check('配對碼可被鏡頭辨識、轉向不會誤讀', pairSafe, pair);

  if (hasPrint) {
    const before = await tv.evaluate(() => document.querySelectorAll('#print-cards-container canvas').length);
    check('開網頁時不再預先畫列印大圖', before === 0, `已畫 ${before} 張`);
    await tv.evaluate(() => switchTab('print'));
    await tv.waitForTimeout(2500);
    const thumbs = await tv.evaluate(() => Array.from(document.querySelectorAll('#print-cards-container canvas')).map(c => c.width));
    check('進入列印分頁才畫預覽，且為縮圖尺寸', thumbs.length === 28 && thumbs.every(w => w === 560), `${thumbs.length} 張，寬 ${thumbs[0]}`);
    await tv.evaluate(() => switchTab('tv'));
  }

  // 載入題庫 12345
  await tv.evaluate(async () => { document.getElementById('tv-code-input').value = '12345'; loadCloudQuizFromTv(); });
  await tv.waitForTimeout(500);
  await tv.evaluate(() => pushTvMailboxToCloud());

  // ---------- 手機 ----------
  let phone = await openPage(browser, env, file, true);
  await phone.evaluate(p => connectMobileToTv(p), pair);
  await phone.waitForTimeout(800);
  check('手機與大電視配對成功', await phone.evaluate(() => isMobilePaired));

  await phone.evaluate(() => { for (let s = 1; s <= 5; s++) cycleSeatAnswer(s); });
  await tv.waitForTimeout(2200);
  const tvAnswers1 = await tv.evaluate(() => Object.keys(studentAnswers).length);
  check('手機作答同步到大電視', tvAnswers1 === 5, `大電視收到 ${tvAnswers1} 筆`);

  // 手機重新整理（iPhone 鎖屏後 Safari 常見），重新配對再作答
  await phone.context().close();
  phone = await openPage(browser, env, file, true);
  await phone.evaluate(p => connectMobileToTv(p), pair);
  await phone.waitForTimeout(800);
  await phone.evaluate(() => { for (let s = 1; s <= 8; s++) cycleSeatAnswer(s); cycleSeatAnswer(8); });
  await tv.waitForTimeout(2200);
  const tvAns = await tv.evaluate(() => JSON.stringify(studentAnswers));
  check('手機重新整理後，大電視仍收得到新作答', JSON.parse(tvAns)['8'] === '2', tvAns);

  // ---------- 小班 ----------
  const small = await phone.evaluate(() => { updateClassSize(6, true); const n = classSize; updateClassSize(28, true); return n; });
  check('班級人數可設為 6 人', small === 6, String(small));

  // ---------- 分數與重複上傳（在手機上操作） ----------
  await phone.evaluate(async () => {
    questionAnswersMemory = { 0: { 1: '1', 2: '2', 3: '1' }, 1: { 1: '1', 2: '1' } };  // 3 號第 2 題沒作答
    questionLockedState = { 0: '1', 1: '1' };
    studentAnswers = {};
    await uploadClassSessionToGAS();
  });
  await phone.waitForTimeout(300);
  const rows1 = env.ss.sheets.Scores_1.data.length;
  phone.dialogPolicy = d => d.dismiss();
  await phone.evaluate(async () => { studentAnswers = {}; await uploadClassSessionToGAS(); });
  await phone.waitForTimeout(300);
  check('同一場再按上傳會先詢問，取消就不會重複寫入', env.ss.sheets.Scores_1.data.length === rows1 && phone.dialogs.some(m => m.includes('已經上傳過')), `${rows1} → ${env.ss.sheets.Scores_1.data.length}`);

  const logs = post(env, { action: 'getTeacherRecords', roomCode: '12345', teacherPin: '1234' }).allLogs;
  const scoresBySeat = await tv.evaluate(l => Object.fromEntries(l.map(unpackLogRecord).map(r => [r.seatNo + '/' + r.quizNo, r.score])), logs);
  check('後台分數：缺答算進分母（3 號 1/2 = 50 分）', scoresBySeat['03/測驗二'] === 50, JSON.stringify(scoresBySeat));
  check('後台分數：全對 100、答錯一題 50', scoresBySeat['01/測驗二'] === 100 && scoresBySeat['02/測驗二'] === 50);
  check('舊版已上傳的缺答紀錄也自動更正（9 號 2/4 = 50 分）', scoresBySeat['09/測驗一'] === 50);

  check('過程中沒有 JavaScript 錯誤', tv.errors.length + phone.errors.length === 0, tv.errors.concat(phone.errors).join(' | '));
  await tv.context().close(); await phone.context().close();
  return results;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  let fail = 0;
  for (const f of process.argv.slice(2)) {
    console.log('\n■ ' + path.basename(f));
    for (const r of await runGame(browser, f)) {
      console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : '  → ' + r.detail}`);
      if (!r.ok) fail++;
    }
  }
  await browser.close();
  console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
  process.exitCode = fail ? 1 : 0;
})();
