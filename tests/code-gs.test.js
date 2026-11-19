// 執行方式：node tests/code-gs.test.js
// 從「v3.0 舊資料」出發，驗證 v3.1 的相容性與每一個安全修補。
const assert = require('assert');
const { createEnv, run, post, get } = require('./gas-mock');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

// ---------- 準備一份 v3.0 格式的舊資料 ----------
const env = createEnv();
env.props.AUTH_HUB_SPREADSHEET_ID = 'HUB_ID';
env.props.SUPER_ADMIN_PASS = 'New-Super-Pass-2026';
env.hub.sheets.Users.data.push(['TeacherA', '王老師', '', '', 'FRIEND', 5, 'ACTIVE', '永久有效']);
env.hub.sheets.Users.data.push(['TeacherB', '李老師', '', '', 'FRIEND', 5, 'ACTIVE', '永久有效']);

const cfgs = env.ss.insertSheet('Configs');
cfgs.data.push(['roomCode', 'teacherPin', 'configJson', 'updatedAt', 'ownerPass', 'ownerName']);
const legacyCfg = { title: '分數加法', roomPin: '1234', tasks: [{ task: '1+1', options: ['1', '2', '3', '4'], answer: 2 }] };
cfgs.appendRow(["'12345", "'1234", JSON.stringify(legacyCfg), new Date(), "'TeacherA", '王老師']);
cfgs.appendRow(["'01234", "'0007", JSON.stringify({ title: '前導零代碼', roomPin: '0007' }), new Date(), '', '舊版未綁定']);

const scores = env.ss.insertSheet('Scores_1');
scores.data.push(['timestamp', 'roomCode', 'seatNo', 'playerName', 'score', 'correctCount', 'wrongCount', 'maxCombo', 'durationSeconds', 'rankTitle']);
scores.appendRow(['2026-11-01 10:00:00', "'12345", "'05", '五年一班_05號 (測驗一)', 80, 8, 2, 8, 150, '⚡||分數加法||1+1(誤選:3)||五年一班||測驗一']);
scores.appendRow(['2026-11-01 10:00:00', "'12345", "'06", '五年一班_06號 (測驗一)', 100, 10, 0, 10, 150, '👑||分數加法||全對無失誤||五年一班||測驗一']);
scores.appendRow(['2026-11-01 10:00:00', "'19999", "'01", '別班', 50, 5, 5, 5, 150, '🌱||x||y||三年二班||測驗一']);

console.log('\n[A] 升級前（尚未執行 setupSecurity）的相容性');
test('公開的 getRoomConfig 不再洩漏 roomPin', () => {
  const r = get(env, { action: 'getRoomConfig', roomCode: '12345' });
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(r.config.title, '分數加法');
  assert.ok(!('roomPin' in r.config));
});
test('舊的明碼 PIN 仍可登入', () => {
  const r = post(env, { action: 'verifyRoomPin', roomCode: '12345', teacherPin: '1234' });
  assert.strictEqual(r.status, 'success'); assert.ok(!('roomPin' in r));
});
test('未完成安全設定時，建立新代碼會清楚提示要先執行 setupSecurity', () => {
  const r = post(env, { action: 'createNewRoom', roomCode: '22222', teacherPin: '9', teacherPass: 'TeacherA', config: {} });
  assert.strictEqual(r.code, 'NOT_SETUP');
});

console.log('\n[B] 執行 setupSecurity()');
test('轉換明碼並清除題庫內的密碼', () => {
  const msg = run(env, 'setupSecurity');
  assert.ok(/管理密碼 2 筆/.test(msg) && /建立者通行碼 1 筆/.test(msg) && /清除題庫內密碼 2 筆/.test(msg), msg);
  assert.ok(String(cfgs.data[1][1]).startsWith('h1$'));
  assert.ok(String(cfgs.data[1][4]).startsWith('h1$'));
  assert.ok(!cfgs.data[1][2].includes('roomPin'));
  assert.strictEqual(cfgs.data[2][0], '01234', '代碼的前導零必須保留');
});
test('setupSecurity 可重複執行，不會重複雜湊', () => {
  const before = cfgs.data[1][1];
  const msg = run(env, 'setupSecurity');
  assert.ok(/管理密碼 0 筆/.test(msg), msg);
  assert.strictEqual(cfgs.data[1][1], before);
});

console.log('\n[C] 雜湊後的登入');
test('正確 PIN 可登入', () => assert.strictEqual(post(env, { action: 'verifyRoomPin', roomCode: '12345', teacherPin: '1234' }).status, 'success'));
test('前導零 PIN（0007）可登入', () => assert.strictEqual(post(env, { action: 'verifyRoomPin', roomCode: '01234', teacherPin: '0007' }).status, 'success'));
test('建立者通行碼（不分大小寫）免 PIN 登入', () => assert.strictEqual(post(env, { action: 'verifyRoomPin', roomCode: '12345', teacherPass: 'teachera' }).status, 'success'));
test('別的老師的通行碼不能進入', () => assert.strictEqual(post(env, { action: 'verifyRoomPin', roomCode: '12345', teacherPass: 'TeacherB' }).code, 'AUTH_FAILED'));
test('新的最高管理員密碼（來自指令碼屬性）可進入任何代碼', () => {
  const r = post(env, { action: 'verifyRoomPin', roomCode: '12345', teacherPass: 'New-Super-Pass-2026' });
  assert.strictEqual(r.status, 'success'); assert.strictEqual(r.isSuperAdmin, true);
});
test('舊的寫死密碼已失效', () => assert.notStrictEqual(post(env, { action: 'verifyRoomPin', roomCode: '12345', teacherPass: 'old-hardcoded-pass' }).status, 'success'));
test('00000＋0622 後門已移除', () => assert.notStrictEqual(post(env, { action: 'verifyRoomPin', roomCode: '00000', teacherPin: '0622' }).status, 'success'));
test('verifyTeacherPass 回傳我的代碼，但不含管理密碼', () => {
  const r = post(env, { action: 'verifyTeacherPass', teacherPass: 'TeacherA' });
  assert.strictEqual(r.status, 'success');
  assert.deepStrictEqual(r.myRooms.map(x => x.roomCode), ['12345']);
  assert.ok(!('roomPin' in r.myRooms[0]));
  assert.strictEqual(r.remainingQuota, 4);
});

console.log('\n[D] 漏洞修補：修改題庫');
test('不帶密碼無法覆寫別人的題庫', () => {
  const r = post(env, { action: 'saveRoomConfig', roomCode: '12345', teacherPin: '', config: { title: '被駭了' } });
  assert.strictEqual(r.code, 'AUTH_FAILED');
  assert.ok(get(env, { action: 'getRoomConfig', roomCode: '12345' }).config.title === '分數加法');
});
test('建立者用通行碼可以儲存，且管理密碼不會被改掉', () => {
  const pinBefore = cfgs.data[1][1];
  const r = post(env, { action: 'saveRoomConfig', roomCode: '12345', teacherPin: 'undefined', teacherPass: 'TeacherA', config: { title: '分數加法 v2', roomPin: 'undefined', tasks: [] } });
  assert.strictEqual(r.status, 'success', JSON.stringify(r));
  assert.strictEqual(cfgs.data[1][1], pinBefore);
  assert.ok(!cfgs.data[1][2].includes('roomPin'));
  assert.strictEqual(get(env, { action: 'getRoomConfig', roomCode: '12345' }).config.title, '分數加法 v2');
});
test('題庫過大時回傳清楚的錯誤，而不是寫入失敗', () => {
  const big = { title: 'x', tasks: [{ explanation: 'a'.repeat(60000) }] };
  assert.strictEqual(post(env, { action: 'saveRoomConfig', roomCode: '12345', teacherPin: '1234', config: big }).code, 'TOO_LARGE');
});

console.log('\n[E] 漏洞修補：清空成績');
test('不帶密碼無法清空成績', () => {
  assert.strictEqual(post(env, { action: 'clearRoomScores', roomCode: '12345' }).code, 'AUTH_FAILED');
  assert.strictEqual(scores.data.length, 4);
});

console.log('\n[F] 防暴力破解');
test('同一代碼錯 5 次後暫停，連正確密碼也要等 10 分鐘', () => {
  for (let i = 0; i < 4; i++) post(env, { action: 'verifyRoomPin', roomCode: '01234', teacherPin: '000' + i });
  assert.strictEqual(post(env, { action: 'verifyRoomPin', roomCode: '01234', teacherPin: '9999' }).code, 'AUTH_FAILED');
  assert.strictEqual(post(env, { action: 'verifyRoomPin', roomCode: '01234', teacherPin: '0007' }).code, 'TOO_MANY_ATTEMPTS');
  env.cache.delete('FAIL_ROOM_01234');
  assert.strictEqual(post(env, { action: 'verifyRoomPin', roomCode: '01234', teacherPin: '0007' }).status, 'success');
});

console.log('\n[G] 成績上傳與清空');
test('整批上傳；wantLeaderboard:false 時不回傳排行榜', () => {
  const recs = Array.from({ length: 28 }, (_, i) => ({ seatNo: String(i + 1).padStart(2, '0'), playerName: 'x', score: 90, correctCount: 9, wrongCount: 1, rankTitle: 'a||b||c||五年一班||測驗二' }));
  const r = post(env, { action: 'submitBatchScores', roomCode: '12345', records: recs, wantLeaderboard: false });
  assert.strictEqual(r.status, 'success'); assert.strictEqual(r.written, 28); assert.ok(!r.leaderboard);
  assert.strictEqual(scores.data.length, 4 + 28);
  assert.strictEqual(scores.data[4][2], '01', '座號 01 必須保留為文字');
});
test('舊版前端（未帶 wantLeaderboard）仍會拿到排行榜', () => {
  const r = post(env, { action: 'submitScore', roomCode: '19999', seatNo: '02', playerName: 'y', score: 70 });
  assert.ok(Array.isArray(r.leaderboard));
});
test('getQuizSessions 只回傳班級與場次，不含分數', () => {
  const r = get(env, { action: 'getQuizSessions', roomCode: '12345' });
  assert.deepStrictEqual(r.sessions, [{ className: '五年一班', quizNo: '測驗一' }, { className: '五年一班', quizNo: '測驗二' }]);
  assert.ok(!JSON.stringify(r).includes('score'));
});
test('POST getTeacherRecords 需要驗證', () => {
  assert.strictEqual(post(env, { action: 'getTeacherRecords', roomCode: '12345', teacherPin: 'nope' }).code, 'AUTH_FAILED');
  const ok = post(env, { action: 'getTeacherRecords', roomCode: '12345', teacherPin: '1234' });
  assert.strictEqual(ok.allLogs.length, 30);
});
test('舊版 GET getTeacherRecords 預設仍可用；開啟 REQUIRE_AUTH_FOR_RECORDS 後停用', () => {
  assert.strictEqual(get(env, { action: 'getTeacherRecords', roomCode: '12345' }).status, 'success');
  env.props.REQUIRE_AUTH_FOR_RECORDS = 'true';
  assert.strictEqual(get(env, { action: 'getTeacherRecords', roomCode: '12345' }).code, 'AUTH_REQUIRED');
  delete env.props.REQUIRE_AUTH_FOR_RECORDS;
});
test('用正確密碼清空：只刪本代碼，資料移到 Trash_Scores，其他代碼與座號格式完整保留', () => {
  const r = post(env, { action: 'clearRoomScores', roomCode: '12345', teacherPin: '1234' });
  assert.strictEqual(r.status, 'success'); assert.strictEqual(r.cleared, 30);
  const remaining = scores.data.slice(1).filter(row => row.some(v => v !== ''));
  assert.strictEqual(remaining.length, 2);
  assert.strictEqual(remaining[0][1], '19999'); assert.strictEqual(remaining[0][2], '01');
  assert.strictEqual(env.ss.sheets.Trash_Scores.data.length, 31);
  assert.strictEqual(env.ss.sheets.Trash_Scores.data[1][3], '05');
});

console.log('\n[H] 建立新代碼');
test('建立時密碼與通行碼都存成雜湊，題庫內不含密碼', () => {
  const r = post(env, { action: 'createNewRoom', roomCode: '23456', teacherPin: '5678', teacherPass: 'TeacherB', config: { title: '新題庫', roomPin: '5678' } });
  assert.strictEqual(r.status, 'success', JSON.stringify(r));
  const row = cfgs.data[cfgs.data.length - 1];
  assert.ok(String(row[1]).startsWith('h1$') && String(row[4]).startsWith('h1$'));
  assert.ok(!row[2].includes('5678'));
  assert.strictEqual(post(env, { action: 'verifyRoomPin', roomCode: '23456', teacherPin: '5678' }).status, 'success');
});
test('重複代碼會被拒絕', () => assert.strictEqual(post(env, { action: 'createNewRoom', roomCode: '23456', teacherPin: '1', teacherPass: 'TeacherB', config: {} }).code, 'CODE_TAKEN'));
test('沒有通行碼不能建立（除非開啟 ALLOW_CREATE_WITHOUT_PASS）', () => {
  assert.strictEqual(post(env, { action: 'createNewRoom', roomCode: '34567', teacherPin: '1', config: {} }).code, 'AUTH_REQUIRED');
  env.props.ALLOW_CREATE_WITHOUT_PASS = 'true';
  assert.strictEqual(post(env, { action: 'createNewRoom', roomCode: '34567', teacherPin: '1', config: {} }).status, 'success');
  delete env.props.ALLOW_CREATE_WITHOUT_PASS;
});
test('額度用完時拒絕建立', () => {
  env.hub.sheets.Users.data.push(['TeacherC', '陳老師', '', '', 'FRIEND', 1, 'ACTIVE', '永久有效']);
  assert.strictEqual(post(env, { action: 'createNewRoom', roomCode: '45678', teacherPin: '1', teacherPass: 'TeacherC', config: {} }).status, 'success');
  assert.strictEqual(post(env, { action: 'createNewRoom', roomCode: '45679', teacherPin: '1', teacherPass: 'TeacherC', config: {} }).code, 'QUOTA_FULL');
});

console.log('\n[I] 雙機同步與錯誤處理（行為須與 v3.0 相同）');
test('TV / 手機信箱讀寫', () => {
  post(env, { action: 'initTvSession', senderRole: 'TV', roomCode: 'T4321', pairCode: '4321', live: { tvSeq: 1, qIndex: 0 } });
  post(env, { action: 'syncLiveState', senderRole: 'MOBILE', roomCode: 'M4321', live: { mobSeq: 3 } });
  assert.strictEqual(get(env, { action: 'getLiveState', roomCode: 'T4321', pairCode: '4321' }).live.tvSeq, 1);
  assert.strictEqual(get(env, { action: 'getLiveState', roomCode: 'M4321' }).live.mobSeq, 3);
  assert.strictEqual(get(env, { action: 'getLiveState', roomCode: 'M9999' }).live, null);
});
test('格式錯誤的請求回傳 JSON 錯誤，而不是 HTML 錯誤頁', () => assert.strictEqual(post(env, '{oops').code, 'BAD_REQUEST'));
test('未知指令', () => assert.strictEqual(post(env, { action: 'hack' }).code, 'UNKNOWN_ACTION'));

console.log(`\n${passed} 項通過` + (process.exitCode ? '，有失敗項目' : '，全部通過'));
