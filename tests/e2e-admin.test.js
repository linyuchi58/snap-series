// 端對端測試：在真的瀏覽器開啟遊戲 HTML，把它送往 script.google.com 的請求轉給模擬的 Code.gs v3.1，
// 然後照老師的實際操作順序走一遍。用法：node tests/e2e-admin.test.js games/popquiz-snap.html [...]
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
  const cfg = { title: '分數加法', roomPin: '1234', classes: ['五年一班'], tasks: [
    { task: '1/2+1/2', options: ['1', '2', '3', '4'], answer: 1, explanation: '' },
    { task: '1/4+1/4', options: ['1/2', '1', '2', '3'], answer: 1, explanation: '' }] };
  cfgs.appendRow(["'12345", "'1234", JSON.stringify(cfg), new Date(), "'TeacherA", '王老師']);
  const s = env.ss.insertSheet('Scores_1');
  s.data.push(['timestamp', 'roomCode', 'seatNo', 'playerName', 'score', 'correctCount', 'wrongCount', 'maxCombo', 'durationSeconds', 'rankTitle']);
  s.appendRow(['2026-11-01 10:00:00', "'12345", "'05", '五年一班_05號 (測驗一)', 50, 1, 1, 1, 30, '⚡||分數加法||x||五年一班||測驗一']);
  run(env, 'setupSecurity');
  return env;
}

async function runGame(browser, file) {
  const env = seed();
  const page = await browser.newPage();
  const errors = [], calls = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.protocol === 'file:') return route.continue();
    if (url.hostname === 'script.google.com') {
      let out;
      if (req.method() === 'POST') { const b = JSON.parse(req.postData() || '{}'); calls.push(b.action); out = post(env, b); }
      else { const p = Object.fromEntries(url.searchParams); calls.push(p.action); out = get(env, p); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    }
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); // 外部 CDN / QR 一律不連線
  });
  await page.goto('file://' + path.resolve(file));
  await page.waitForTimeout(800);

  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
  const ev = fn => page.evaluate(fn);

  // 1. 教師用通行碼登入，看得到自己的代碼
  const rooms = await ev(async () => {
    document.getElementById('teacher-pin-modal-input').value = 'TeacherA';
    await verifyTeacherStep1();
    return adminSession.myRooms;
  });
  check('通行碼登入並列出我的代碼（不含 PIN）', rooms.length === 1 && rooms[0].roomCode === '12345' && !('roomPin' in rooms[0]), JSON.stringify(rooms));
  const chipHtml = await ev(() => document.getElementById('teacher-quota-status-banner').innerHTML);
  check('快速進入按鈕不再含有密碼', chipHtml.includes("quickEnterMyRoom('12345')") && !chipHtml.includes('undefined'));

  // 2. 免密碼快速進入 → 後台載入成績
  await ev(() => quickEnterMyRoom('12345'));
  await page.waitForTimeout(400);
  const admin = await ev(() => ({ code: adminSession.roomCode, logs: cachedTeacherData.allLogs.length, title: params.title, summary: document.getElementById('admin-record-summary').textContent }));
  check('快速進入後台並以 POST 讀到成績', admin.code === '12345' && admin.logs === 1, JSON.stringify(admin));
  check('成績改用需驗證的 POST 讀取', calls.filter(a => a === 'getTeacherRecords').length >= 1);

  // 3. 修改並儲存題庫
  await ev(async () => { document.getElementById('set-title').value = '分數加法（修訂）'; await saveRoomConfigToCloud(); });
  const saved = get(env, { action: 'getRoomConfig', roomCode: '12345' });
  check('儲存題庫成功', saved.config && saved.config.title === '分數加法（修訂）', JSON.stringify(saved).slice(0, 120));
  check('題庫內不再有 roomPin', !JSON.stringify(env.ss.sheets.Configs.data[1][2]).includes('roomPin'));
  check('儲存後原本的 PIN 1234 仍可登入', post(env, { action: 'verifyRoomPin', roomCode: '12345', teacherPin: '1234' }).status === 'success');

  // 4. 模擬一場測驗並上傳
  const before = env.ss.sheets.Scores_1.data.length;
  await ev(async () => {
    questionAnswersMemory = { 0: { 1: '1', 2: '2', 3: '1' }, 1: { 1: '1', 2: '1' } };
    questionLockedState = { 0: '1', 1: '1' };
    studentAnswers = {};
    await uploadClassSessionToGAS();
  });
  await page.waitForTimeout(300);
  const added = env.ss.sheets.Scores_1.data.length - before;
  check('上傳全班成績（3 位）', added === 3, `新增 ${added} 列`);
  const quizNo = await ev(() => currentQuizNoStr);
  check('上傳後自動推算下一個場次', quizNo === '測驗三', quizNo);

  // 5. 清空成績（帶通行碼驗證）
  await ev(() => executeClearRoomRecords());
  await page.waitForTimeout(400);
  const left = env.ss.sheets.Scores_1.data.slice(1).filter(r => r.some(v => v !== '')).length;
  check('清空成績成功（已移到 Trash_Scores）', left === 0 && env.ss.sheets.Trash_Scores.data.length === 5, `剩 ${left} 列`);

  check('過程中沒有 JavaScript 錯誤', errors.length === 0, errors.join(' | '));
  await page.close();
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
