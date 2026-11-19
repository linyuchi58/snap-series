// 共用後端端對端測試：逆轉王、攀岩王、甜點派對接同一個後端
// 用法：node tests/e2e-shared.test.js
const path = require('path');
const { chromium } = require('playwright');
const { createEnv, run, post, get } = require('./gas-mock');

const GAMES = [
  ['games/popquiz-showdown.html', '逆轉王'],
  ['games/yushan-snap.html', '攀岩王'],
  ['games/sweet-monster-snap.html', '甜點派對'],
];

(async () => {
  const env = createEnv();
  env.props.AUTH_HUB_SPREADSHEET_ID = 'HUB_ID';
  env.props.SUPER_ADMIN_PASS = 'New-Super-Pass-2026';
  env.hub.sheets.Users.data.push(['TeacherA', '王老師', '', '', 'FRIEND', 5, 'ACTIVE', '永久有效']);
  env.ss.insertSheet('Configs').data.push(['roomCode', 'teacherPin', 'configJson', 'updatedAt', 'ownerPass', 'ownerName']);
  run(env, 'setupSecurity');
  const backendHosts = new Set();

  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const open = async file => {
    const page = await browser.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.protocol === 'file:') return route.continue();
      if (url.hostname === 'script.google.com') {
        backendHosts.add(url.pathname);
        const out = req.method() === 'POST' ? post(env, JSON.parse(req.postData() || '{}')) : get(env, Object.fromEntries(url.searchParams));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
      }
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await page.goto('file://' + path.resolve(file));
    await page.waitForTimeout(700);
    return page;
  };

  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

  // 1. 在攀岩王建立代碼 33333
  const yushan = await open(GAMES[1][0]);
  const created = await yushan.evaluate(async () => {
    document.getElementById('teacher-pin-modal-input').value = 'TeacherA';
    await verifyTeacherStep1();
    document.getElementById('create-room-code-input').value = '33333';
    document.getElementById('create-room-pin-input').value = '4321';
    await submitCreateRoom();
    return adminSession.roomCode;
  });
  check('在攀岩王建立代碼 33333', created === '33333' && env.ss.sheets.Configs.data.some(r => r[0] === '33333'), created);
  await yushan.close();

  // 2. 三款各自載入 33333 並上傳一場成績
  for (const [file, label] of GAMES) {
    const page = await open(file);
    const title = await page.evaluate(async () => {
      document.getElementById('tv-code-input').value = '33333';
      await loadCloudQuizFromTv();
      return params.title;
    });
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      questionAnswersMemory = { 0: { 1: '1', 2: '2' } };
      questionLockedState = { 0: '1' };
      studentAnswers = {};
      await uploadClassSessionToGAS();
    });
    await page.waitForTimeout(300);
    check(`${label}：讀到同一份題庫並上傳成功`, !!title && page.errors.length === 0, `${title} ${page.errors.join('|')}`);
    await page.close();
  }

  // 3. 從甜點派對的後台看全部成績
  const sweet = await open(GAMES[2][0]);
  const seen = await sweet.evaluate(async () => {
    document.getElementById('teacher-pin-modal-input').value = 'TeacherA';
    await verifyTeacherStep1();
    await quickEnterMyRoom('33333');
    await new Promise(r => setTimeout(r, 400));
    const logs = cachedTeacherData.allLogs;
    document.getElementById('admin-view-mode').value = 'all_logs'; renderTeacherTable();
    return { games: logs.map(l => l.gameName).sort(), quizNos: [...new Set(logs.map(l => l.quizNo))].sort(), html: document.getElementById('admin-records-tbody').innerHTML };
  });
  check('後台看得到三款遊戲的成績', seen.games.filter(g => g).length === 6, JSON.stringify(seen.games));
  check('每筆成績標明來自哪一款遊戲', ['逆轉王', '攀岩王', '甜點派對'].every(g => seen.games.includes(g) && seen.html.includes(g)));
  check('三款共用場次編號（測驗一、二、三）', seen.quizNos.length === 3, JSON.stringify(seen.quizNos));
  check('三款都連到同一個後端網址', backendHosts.size === 1, [...backendHosts].join(' , '));
  await browser.close();

  let fail = 0;
  for (const r of results) { console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : '  → ' + r.detail}`); if (!r.ok) fail++; }
  console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
  process.exitCode = fail ? 1 : 0;
})();
