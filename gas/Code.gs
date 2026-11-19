// =================================================================================
// 🚀 萬用遊戲端 Code.gs [v3.1 安全強化版]
// 相容：所有一般遊戲 + 舉牌秒答樂系列（雙信箱同步）+ 跨表額度驗證 + 快照備份
//
// v3.1 相對 v3.0 的變更（2026-11-19）：
//   1. 密碼與總表 ID 改存「指令碼屬性」，程式碼內不再有任何密碼；移除 00000＋0622 後門
//   2. saveRoomConfig / clearRoomScores 必須通過身分驗證（管理密碼、建立者通行碼或最高管理員）
//   3. 管理密碼與建立者通行碼改存雜湊值；舊的明碼資料仍可登入，執行 setupSecurity() 後一次轉換
//   4. 題庫 JSON 不再夾帶管理密碼（getRoomConfig 是公開讀取，舊版會把 PIN 一起送出）
//   5. 同一代碼 10 分鐘內密碼錯 5 次即暫停 10 分鐘
//   6. 所有錯誤一律回傳 JSON（含 code 欄位），不再回傳 HTML 錯誤頁
//   7. 成績整批寫入、只有寫入動作才上鎖、清空成績改為整批處理並移到「Trash_Scores」可救回
//   8. 新增：POST getTeacherRecords（需驗證）、GET getQuizSessions（只回傳場次清單，不含分數）
//
// ⚙️ 部署前必做（只需一次）：
//   專案設定 → 指令碼屬性，新增：
//     SUPER_ADMIN_PASS          最高管理員通行碼（請設定一組「新的」密碼）
//     AUTH_HUB_SPREADSHEET_ID   中央授權總表的試算表 ID
//   選填：
//     REQUIRE_AUTH_FOR_RECORDS  設為 true 後，GET getTeacherRecords 停用（所有遊戲前端都更新後再開）
//     ALLOW_CREATE_WITHOUT_PASS 設為 true 才允許「不帶教師通行碼」建立新代碼（舊版相容用）
//   接著在編輯器上方選擇 setupSecurity 並按「執行」。
// =================================================================================

const CODE_VERSION = "v3.1-Secure";
const DEFAULT_GAME_QUOTA = 5;
const CONFIG_CELL_LIMIT = 49000;          // Google 試算表單一儲存格上限 50,000 字元
const FAIL_LIMIT = 5;                     // 密碼錯誤次數上限
const FAIL_WINDOW_SECONDS = 600;          // 計算與暫停的時間窗（秒）
const HASH_PREFIX = "h1$";
const SENSITIVE_CONFIG_KEYS = ["roomPin", "teacherPin", "teacherPass", "ownerPass"];

// ---------------------------------------------------------------------------------
// 🔑 祕密設定與雜湊工具
// ---------------------------------------------------------------------------------
// 每次執行只讀一次指令碼屬性（指令碼屬性有每日讀取配額）
let PROPS_MEMO_ = null;
function getProp_(key) {
  if (!PROPS_MEMO_) PROPS_MEMO_ = PropertiesService.getScriptProperties().getProperties() || {};
  return String(PROPS_MEMO_[key] || "").trim();
}
function getSuperPass_() { return getProp_("SUPER_ADMIN_PASS"); }
function getHubId_() { return getProp_("AUTH_HUB_SPREADSHEET_ID"); }
function flagOn_(key) { return getProp_(key).toLowerCase() === "true"; }

function getSalt_() {
  const salt = getProp_("PIN_SALT");
  if (!salt) throw new AppError_("NOT_SETUP", "⚙️ 後端尚未完成安全設定，請管理員在 Apps Script 編輯器執行一次 setupSecurity()。");
  return salt;
}

const HASH_MEMO_ = {};
function hashSecret_(plain) {
  if (HASH_MEMO_[plain]) return HASH_MEMO_[plain];
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, getSalt_() + "|" + plain, Utilities.Charset.UTF_8);
  return (HASH_MEMO_[plain] = HASH_PREFIX + Utilities.base64EncodeWebSafe(bytes));
}

function stripQuote_(v) { return String(v == null ? "" : v).replace(/^'/, "").trim(); }

// 比對管理密碼（區分大小寫）；同時支援雜湊值與舊版明碼
function matchPin_(stored, input) {
  const s = stripQuote_(stored), i = String(input || "").trim();
  if (!s || !i) return false;
  return s.indexOf(HASH_PREFIX) === 0 ? s === hashSecret_(i) : s === i;
}

// 比對教師通行碼（不分大小寫，與中央授權總表一致）
function matchPass_(stored, input) {
  const s = stripQuote_(stored), i = String(input || "").trim().toLowerCase();
  if (!s || !i) return false;
  return s.indexOf(HASH_PREFIX) === 0 ? s === hashSecret_(i) : s.toLowerCase() === i;
}

function isSuperPass_(input) {
  const sp = getSuperPass_(), i = String(input || "").trim();
  return !!sp && !!i && sp.toLowerCase() === i.toLowerCase();
}

function sanitizeConfig_(cfg) {
  const out = (cfg && typeof cfg === "object") ? JSON.parse(JSON.stringify(cfg)) : {};
  SENSITIVE_CONFIG_KEYS.forEach(k => { delete out[k]; });
  return out;
}

function parseConfigCell_(cell) {
  try { return sanitizeConfig_(JSON.parse(cell || "{}")); } catch (e) { return {}; }
}

// ---------------------------------------------------------------------------------
// 🧯 錯誤處理、輸出與防暴力破解
// ---------------------------------------------------------------------------------
function AppError_(code, message) { this.code = code; this.message = message; }

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function errOut_(code, message) { return jsonOut({ status: "error", code: code, message: message }); }

function handleError_(err) {
  if (err instanceof AppError_) return errOut_(err.code, err.message);
  console.error(err && err.stack ? err.stack : err);
  return errOut_("SERVER_ERROR", "⚠️ 伺服器暫時發生錯誤，請稍後再試。（" + (err && err.message ? err.message : err) + "）");
}

function failKey_(scope, id) { return "FAIL_" + scope + "_" + id; }
function assertNotLocked_(scope, id) {
  const n = Number(CacheService.getScriptCache().get(failKey_(scope, id)) || 0);
  if (n >= FAIL_LIMIT) throw new AppError_("TOO_MANY_ATTEMPTS", "🛑 密碼錯誤次數過多，此代碼已暫停驗證 10 分鐘，請稍後再試。");
}
function recordFail_(scope, id) {
  const cache = CacheService.getScriptCache(), key = failKey_(scope, id);
  cache.put(key, String(Number(cache.get(key) || 0) + 1), FAIL_WINDOW_SECONDS);
}
function clearFail_(scope, id) { CacheService.getScriptCache().remove(failKey_(scope, id)); }

// 只有寫入動作才上鎖；拿不到鎖時回傳「忙碌中」而不是丟出例外
function withWriteLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new AppError_("BUSY", "⏳ 目前使用人數較多，請 3 秒後再試一次。");
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------------------------
// 📄 工作表工具
// ---------------------------------------------------------------------------------
function getSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 確保 Configs 具有第 5、6 欄 (ownerPass, ownerName)，同時不破壞舊資料前 4 欄
function getConfigsSheet() {
  const sheet = getSheet("Configs", ["roomCode", "teacherPin", "configJson", "updatedAt", "ownerPass", "ownerName"]);
  if (sheet.getLastColumn() < 6) {
    sheet.getRange(1, 5, 1, 2).setValues([["ownerPass", "ownerName"]]);
  }
  return sheet;
}

const SCORE_HEADERS = ["timestamp", "roomCode", "seatNo", "playerName", "score", "correctCount", "wrongCount", "maxCombo", "durationSeconds", "rankTitle"];

function getScoreSheetByCode(roomCode) {
  const prefix = String(roomCode || "00000").charAt(0).replace(/[^0-9]/, "0");
  return getSheet("Scores_" + prefix, SCORE_HEADERS);
}

function normCode_(v) { return stripQuote_(v).padStart(5, "0"); }

// 找出代碼所在列（由下往上，與 v3.0 相同）；回傳 { rowNumber, row } 或 null
function findRoomRow_(sheet, roomCode) {
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (normCode_(rows[i][0]) === roomCode) return { rowNumber: i + 1, row: rows[i] };
  }
  return null;
}

// 代碼授權：管理密碼正確、或是建立者本人的通行碼、或是最高管理員
function authorizeRoom_(found, pin, pass) {
  const isSuper = isSuperPass_(pass);
  const pinOk = matchPin_(found.row[1], pin);
  const ownerOk = !!String(pass || "").trim() && matchPass_(found.row[4], pass);
  return { ok: isSuper || pinOk || ownerOk, isSuper: isSuper };
}

// 驗證房間身分的共用流程（含錯誤次數限制）
function requireRoomAuth_(roomCode, body) {
  assertNotLocked_("ROOM", roomCode);
  const found = findRoomRow_(getConfigsSheet(), roomCode);
  if (!found) {
    if (roomCode === "00000" && isSuperPass_(body.teacherPass)) return { found: null, isSuper: true };
    throw new AppError_("NOT_FOUND", "❌ 找不到代碼 [" + roomCode + "]，請先建立新代碼！");
  }
  const auth = authorizeRoom_(found, body.teacherPin, body.teacherPass);
  if (!auth.ok) {
    recordFail_("ROOM", roomCode);
    throw new AppError_("AUTH_FAILED", "❌ 該代碼的管理密碼不正確！");
  }
  clearFail_("ROOM", roomCode);
  return { found: found, isSuper: auth.isSuper };
}

// ---------------------------------------------------------------------------------
// 🔐 向「中央授權總表」查驗通行碼，並計算在本遊戲的已用額度與代碼清單
// ---------------------------------------------------------------------------------
function verifyPassAndGetQuota(passCode) {
  const cleanPass = String(passCode || "").trim();
  if (!cleanPass) return { valid: false, message: "⚠️ 請輸入教師專屬通行碼！" };

  let userInfo = null;

  if (isSuperPass_(cleanPass)) {
    userInfo = {
      passCode: cleanPass,
      name: "阿集老師 (最高管理員)",
      tier: "SUPER_ADMIN",
      maxQuota: 999,
      isSuperAdmin: true,
      expireDate: "永久有效"
    };
  } else {
    const hubId = getHubId_();
    if (!hubId) {
      return { valid: false, message: "⚠️ 系統尚未綁定中央授權總表 ID，目前僅開放最高管理員通行碼！" };
    }
    try {
      const uSheet = SpreadsheetApp.openById(hubId).getSheetByName("Users");
      if (!uSheet) return { valid: false, message: "❌ 中央授權總表尚未初始化 Users 工作表！" };

      const uRows = uSheet.getDataRange().getValues();
      const tz = Session.getScriptTimeZone() || "Asia/Taipei";
      const todayStr = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");

      for (let i = uRows.length - 1; i >= 1; i--) {
        if (String(uRows[i][0]).trim().toLowerCase() === cleanPass.toLowerCase()) {
          const status = String(uRows[i][6] || "ACTIVE").toUpperCase();
          const exp = String(uRows[i][7] || "永久有效").trim();
          if (status !== "ACTIVE") {
            return { valid: false, message: "🛑 您的通行碼已被停用，請聯繫阿集老師！" };
          }
          if (exp !== "永久有效" && exp !== "" && exp < todayStr) {
            return { valid: false, message: `⏳ 您的研習體驗通行碼已於 ${exp} 到期！請重新申請正式授權。` };
          }
          const tier = String(uRows[i][4] || "FRIEND").toUpperCase();
          const customQ = Number(uRows[i][5]);
          userInfo = {
            passCode: String(uRows[i][0]).trim(),
            name: String(uRows[i][1]).trim(),
            tier: tier,
            maxQuota: (!isNaN(customQ) && customQ > 0) ? customQ : DEFAULT_GAME_QUOTA,
            isSuperAdmin: (tier === "ADMIN"),
            expireDate: exp
          };
          break;
        }
      }
    } catch (err) {
      return { valid: false, message: "❌ 無法連線至中央授權總表，請確認總表 ID 正確！" };
    }
  }

  if (!userInfo) {
    return { valid: false, message: "❌ 通行碼無效！請先填寫表單向阿集老師申請專屬通行碼。" };
  }

  // 掃描本遊戲的 Configs 表，找出這位老師已建立的代碼（不再回傳管理密碼）
  const cRows = getConfigsSheet().getDataRange().getValues();
  const myRooms = [];
  for (let i = 1; i < cRows.length; i++) {
    if (matchPass_(cRows[i][4], userInfo.passCode)) {
      myRooms.push({ roomCode: normCode_(cRows[i][0]), title: parseConfigCell_(cRows[i][2]).title || "自訂題庫" });
    }
  }

  return {
    valid: true,
    user: userInfo,
    usedCount: myRooms.length,
    remainingQuota: Math.max(0, userInfo.maxQuota - myRooms.length),
    myRooms: myRooms
  };
}

// ---------------------------------------------------------------------------------
// 🌐 GET
// ---------------------------------------------------------------------------------
function doGet(e) {
  try { return handleGet_(e); } catch (err) { return handleError_(err); }
}

function handleGet_(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || "";
  const roomCode = String(p.roomCode || "00000").padStart(5, "0");
  const pairCode = String(p.pairCode || p.tvPair || "").trim();
  const cache = CacheService.getScriptCache();

  // 🔗 舉牌系列：讀取即時狀態（TV / 手機信箱）
  if (action === "getLiveState") {
    const key = pairCode ? ("PAIR_" + pairCode) : ("LIVE_" + roomCode);
    const liveStr = cache.get(key) || (pairCode ? cache.get("LIVE_P" + pairCode) : null);
    return jsonOut({ status: "success", live: liveStr ? JSON.parse(liveStr) : null });
  }

  // 📱 舉牌系列 v2.6：手機輸入配對碼握手
  if (action === "joinTvSession" && pairCode) {
    const liveStr = cache.get("PAIR_" + pairCode) || cache.get("LIVE_P" + pairCode);
    if (!liveStr) {
      return jsonOut({ status: "not_found", message: "❌ 找不到配對碼 [" + pairCode + "]！請確認教室大電視看板已開啟並顯示此配對碼。" });
    }
    const liveObj = JSON.parse(liveStr);
    liveObj.mobileConnected = true;
    liveObj.lastMobilePing = Date.now();
    const updatedStr = JSON.stringify(liveObj);
    cache.put("PAIR_" + pairCode, updatedStr, 3600);
    cache.put("LIVE_P" + pairCode, updatedStr, 3600);
    return jsonOut({ status: "success", live: liveObj });
  }

  // 讀取房間題庫設定（公開；回傳前一律移除密碼欄位）
  if (action === "getRoomConfig") {
    const cachedCfg = cache.get("CFG_" + roomCode);
    if (cachedCfg) return jsonOut({ status: "success", config: sanitizeConfig_(JSON.parse(cachedCfg)), fromCache: true });
    const found = findRoomRow_(getConfigsSheet(), roomCode);
    if (!found) return jsonOut({ status: "not_found" });
    const cfg = parseConfigCell_(found.row[2]);
    cache.put("CFG_" + roomCode, JSON.stringify(cfg), 300);
    return jsonOut({ status: "success", config: cfg });
  }

  // 排行榜（公開，一般遊戲使用）
  if (action === "getLeaderboard") {
    const cachedBoard = cache.get("BOARD_" + roomCode);
    if (cachedBoard) return jsonOut({ status: "success", leaderboard: JSON.parse(cachedBoard), fromCache: true });
    const data = readRoomScores(roomCode);
    cache.put("BOARD_" + roomCode, JSON.stringify(data.leaderboard), 30);
    return jsonOut({ status: "success", leaderboard: data.leaderboard });
  }

  // 教師後台紀錄（舊版 GET；所有前端改用 POST 後，請把 REQUIRE_AUTH_FOR_RECORDS 設為 true）
  if (action === "getTeacherRecords") {
    if (flagOn_("REQUIRE_AUTH_FOR_RECORDS")) {
      return errOut_("AUTH_REQUIRED", "🔒 成績紀錄需要登入才能讀取，請更新遊戲頁面後再試。");
    }
    const data = readRoomScores(roomCode);
    cache.put("BOARD_" + roomCode, JSON.stringify(data.leaderboard), 30);
    return jsonOut({ status: "success", leaderboard: data.leaderboard, allLogs: data.allLogs });
  }

  // 🆕 只回傳「班級 × 場次」清單，不含任何分數，供手機端推算下一個場次編號
  if (action === "getQuizSessions") {
    return jsonOut({ status: "success", sessions: readQuizSessions_(roomCode) });
  }

  // 推薦未使用的 5 位數代碼
  if (action === "getRecommendedCodes") {
    const used = new Set(getConfigsSheet().getDataRange().getValues().slice(1).map(r => normCode_(r[0])));
    const rec = [];
    let guard = 0;
    while (rec.length < 4 && guard < 200) {
      guard++;
      const c = String(Math.floor(10000 + Math.random() * 90000));
      if (!used.has(c) && rec.indexOf(c) < 0) rec.push(c);
    }
    return jsonOut({ status: "success", recommended: rec });
  }

  return jsonOut({ status: "ready", version: CODE_VERSION });
}

// ---------------------------------------------------------------------------------
// 📮 POST
// ---------------------------------------------------------------------------------
function doPost(e) {
  try { return handlePost_(e); } catch (err) { return handleError_(err); }
}

function handlePost_(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (x) {
    return errOut_("BAD_REQUEST", "⚠️ 傳送的資料格式不正確。");
  }
  const action = body.action || "";
  const roomCode = String(body.roomCode || "00000").padStart(5, "0");
  const pairCode = String(body.pairCode || body.tvPair || "").trim();
  const cache = CacheService.getScriptCache();

  // 📺 舉牌系列：大電視初始化 / 雙機同步（只寫快取，不需上鎖）
  if (action === "initTvSession" || action === "syncLiveState") {
    const liveData = body.live || {};
    if (body.senderRole === "MOBILE") {
      liveData.mobileConnected = true;
      liveData.lastMobilePing = Date.now();
    } else if (action === "initTvSession") {
      liveData.mobileConnected = false;
    }
    const jsonStr = JSON.stringify(liveData);
    if (pairCode) {
      cache.put("PAIR_" + pairCode, jsonStr, 3600);
      cache.put("LIVE_P" + pairCode, jsonStr, 3600);
    }
    cache.put("LIVE_" + roomCode, jsonStr, 3600);
    return jsonOut({ status: "success" });
  }

  // 🔐 教師通行碼驗證（唯讀）
  if (action === "verifyTeacherPass") {
    const auth = verifyPassAndGetQuota(body.teacherPass);
    if (!auth.valid) return errOut_("AUTH_FAILED", auth.message);
    return jsonOut({
      status: "success",
      user: auth.user,
      usedCount: auth.usedCount,
      remainingQuota: auth.remainingQuota,
      myRooms: auth.myRooms
    });
  }

  // 🔑 驗證代碼管理權限（唯讀；支援管理密碼、建立者通行碼免密碼、最高管理員）
  if (action === "verifyRoomPin") {
    const r = requireRoomAuth_(roomCode, body);
    if (!r.found) {
      return jsonOut({ status: "success", message: "👑 最高管理員驗證通過！", isSuperAdmin: true, config: null });
    }
    return jsonOut({
      status: "success",
      message: "✅ 驗證成功！歡迎進入 [" + roomCode + "] 管理後台。",
      isSuperAdmin: r.isSuper,
      config: parseConfigCell_(r.found.row[2])
    });
  }

  // 📊 教師後台紀錄（需驗證）
  if (action === "getTeacherRecords") {
    requireRoomAuth_(roomCode, body);
    const data = readRoomScores(roomCode);
    return jsonOut({ status: "success", leaderboard: data.leaderboard, allLogs: data.allLogs });
  }

  // ---------------- 以下為寫入動作，必須上鎖 ----------------

  // 學生交卷 / 舉牌批次上傳成績（學生端使用，不需教師密碼）
  if (action === "submitScore" || action === "submitBatchScores") {
    const isBatch = action === "submitBatchScores" && Array.isArray(body.records);
    const records = isBatch ? body.records : [body];
    if (records.length === 0) return jsonOut({ status: "success", written: 0 });
    if (records.length > 200) return errOut_("BAD_REQUEST", "⚠️ 單次上傳筆數過多（上限 200 筆）。");

    const tz = Session.getScriptTimeZone() || "Asia/Taipei";
    const ts = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
    const rows = records.map(rec => [
      ts, "'" + roomCode, "'" + String(rec.seatNo || "-"), String(rec.playerName || "匿名"),
      Number(rec.score) || 0, Number(rec.correctCount) || 0, Number(rec.wrongCount) || 0,
      Number(rec.maxCombo) || 0, Number(rec.durationSeconds) || 0, String(rec.rankTitle || "")
    ]);

    withWriteLock_(() => {
      const sheet = getScoreSheetByCode(roomCode);
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SCORE_HEADERS.length).setValues(rows);
      SpreadsheetApp.flush();
    });
    cache.remove("BOARD_" + roomCode);

    // 舉牌系列上傳後不需要排行榜，前端可傳 wantLeaderboard:false 省下整張表的讀取
    if (body.wantLeaderboard === false) return jsonOut({ status: "success", written: rows.length });
    const data = readRoomScores(roomCode);
    cache.put("BOARD_" + roomCode, JSON.stringify(data.leaderboard), 30);
    return jsonOut({ status: "success", written: rows.length, leaderboard: data.leaderboard });
  }

  // 建立新代碼（需教師通行碼並檢查額度）
  if (action === "createNewRoom") {
    if (!/^\d{5}$/.test(roomCode) || roomCode === "00000") {
      return errOut_("BAD_REQUEST", "⚠️ 請輸入 00001～99999 之間的 5 位數字代碼！");
    }
    const pin = String(body.teacherPin || "").trim();
    if (!pin) return errOut_("BAD_REQUEST", "⚠️ 請設定管理密碼！");
    const teacherPass = String(body.teacherPass || "").trim();

    let ownerName = "舊版未綁定";
    if (teacherPass) {
      const auth = verifyPassAndGetQuota(teacherPass);
      if (!auth.valid) return errOut_("AUTH_FAILED", auth.message);
      if (auth.remainingQuota <= 0 && !auth.user.isSuperAdmin) {
        return errOut_("QUOTA_FULL", `🛑 您的額度已滿（本遊戲已建立 ${auth.usedCount}/${auth.user.maxQuota} 組）！請切換至「🛠️ 維護現有代碼」直接修改您已建立的代碼題庫，無須建立新代碼。`);
      }
      ownerName = auth.user.name;
    } else if (!flagOn_("ALLOW_CREATE_WITHOUT_PASS")) {
      return errOut_("AUTH_REQUIRED", "🔒 建立新代碼需要教師專屬通行碼，請先登入。");
    }

    const cfgStr = JSON.stringify(sanitizeConfig_(body.config));
    if (cfgStr.length > CONFIG_CELL_LIMIT) return errOut_("TOO_LARGE", "⚠️ 題庫內容過大，請減少題數或縮短解說後再儲存。");
    const pinHash = hashSecret_(pin);
    const ownerHash = teacherPass ? hashSecret_(teacherPass.toLowerCase()) : "";

    return withWriteLock_(() => {
      const sheet = getConfigsSheet();
      if (findRoomRow_(sheet, roomCode)) return errOut_("CODE_TAKEN", "⚠️ 此 5 位數代碼已被使用，請換一組！");
      sheet.appendRow(["'" + roomCode, pinHash, cfgStr, new Date(), ownerHash, ownerName]);
      cache.put("CFG_" + roomCode, cfgStr, 300);
      saveConfigSnapshot(roomCode, cfgStr, "CREATE");
      return jsonOut({ status: "success", message: "✅ 成功建立並發布代碼 [" + roomCode + "]！" });
    });
  }

  // 更新既有代碼題庫（需驗證；不再順便改掉管理密碼）
  if (action === "saveRoomConfig") {
    const cfgStr = JSON.stringify(sanitizeConfig_(body.config));
    if (cfgStr.length > CONFIG_CELL_LIMIT) return errOut_("TOO_LARGE", "⚠️ 題庫內容過大，請減少題數或縮短解說後再儲存。");
    const newPin = String(body.newPin || "").trim();

    return withWriteLock_(() => {
      const r = requireRoomAuth_(roomCode, body);
      if (!r.found) return errOut_("NOT_FOUND", "❌ 找不到代碼 [" + roomCode + "]，請先建立新代碼！");
      const sheet = getConfigsSheet();
      sheet.getRange(r.found.rowNumber, 3, 1, 2).setValues([[cfgStr, new Date()]]);
      if (newPin) sheet.getRange(r.found.rowNumber, 2).setValue(hashSecret_(newPin));
      cache.put("CFG_" + roomCode, cfgStr, 300);
      saveConfigSnapshot(roomCode, cfgStr, "UPDATE");
      return jsonOut({ status: "success", message: "✅ 已成功更新代碼 [" + roomCode + "] 的題庫設定！" });
    });
  }

  // 清空特定代碼的成績（需驗證；刪除的資料移到 Trash_Scores，可人工救回）
  if (action === "clearRoomScores") {
    return withWriteLock_(() => {
      requireRoomAuth_(roomCode, body);
      const moved = moveRoomScoresToTrash_(roomCode);
      cache.remove("BOARD_" + roomCode);
      return jsonOut({ status: "success", cleared: moved, message: "🧹 已清空代碼 [" + roomCode + "] 的 " + moved + " 筆紀錄！（備份於 Trash_Scores 工作表）" });
    });
  }

  return errOut_("UNKNOWN_ACTION", "未知指令");
}

// ---------------------------------------------------------------------------------
// 📚 成績讀取與清空
// ---------------------------------------------------------------------------------
function readRoomScores(roomCode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetsToRead = [getScoreSheetByCode(roomCode)];
  const legacySheet = ss.getSheetByName("Scores");
  if (legacySheet) sheetsToRead.push(legacySheet);

  const allLogs = [];
  const bestMap = {};

  sheetsToRead.forEach(sheet => {
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      const rc = normCode_(r[1]);
      if (rc !== roomCode) continue;

      const item = {
        timestamp: String(r[0]),
        roomCode: rc,
        seatNo: stripQuote_(r[2]),
        playerName: String(r[3]),
        score: Number(r[4]) || 0,
        correctCount: Number(r[5]) || 0,
        wrongCount: Number(r[6]) || 0,
        maxCombo: Number(r[7]) || 0,
        durationSeconds: Number(r[8]) || 0,
        rankTitle: String(r[9] || "")
      };
      allLogs.push(item);

      const classPart = (item.rankTitle.split("||")[3] || "預設班級");
      const key = classPart + "__" + item.seatNo + "__" + item.playerName;
      if (!bestMap[key]) {
        bestMap[key] = Object.assign({}, item, { attempts: 1 });
      } else {
        bestMap[key].attempts++;
        if (item.score > bestMap[key].score || (item.score === bestMap[key].score && item.durationSeconds < bestMap[key].durationSeconds)) {
          const att = bestMap[key].attempts;
          bestMap[key] = Object.assign({}, item, { attempts: att });
        }
      }
    }
  });

  const leaderboard = Object.values(bestMap).sort((a, b) => b.score - a.score || a.durationSeconds - b.durationSeconds);
  return { leaderboard: leaderboard, allLogs: allLogs.slice(0, 1000) };
}

// 只回傳「班級 × 場次」組合，不含分數與座號
function readQuizSessions_(roomCode) {
  const rows = getScoreSheetByCode(roomCode).getDataRange().getValues();
  const seen = {};
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (normCode_(rows[i][1]) !== roomCode) continue;
    const parts = String(rows[i][9] || "").split("||");
    if (parts.length < 5) continue;
    const key = parts[3] + "||" + parts[4];
    if (!seen[key]) { seen[key] = true; out.push({ className: parts[3], quizNo: parts[4] }); }
  }
  return out;
}

// 把某代碼的成績整批移到 Trash_Scores，再把其餘資料一次寫回（比逐列 deleteRow 快很多）
function moveRoomScoresToTrash_(roomCode) {
  const sheet = getScoreSheetByCode(roomCode);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const width = SCORE_HEADERS.length;
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const keep = [], drop = [];
  values.forEach(r => (normCode_(r[1]) === roomCode ? drop : keep).push(r));
  if (drop.length === 0) return 0;

  // 文字欄位（代碼、座號）寫回時要保留前導單引號，否則 00123、05 會被轉成數字
  const asText = r => r.map((v, idx) => (idx === 1 || idx === 2) ? "'" + stripQuote_(v) : v);

  const trash = getSheet("Trash_Scores", ["deletedAt"].concat(SCORE_HEADERS));
  const now = new Date();
  trash.getRange(trash.getLastRow() + 1, 1, drop.length, width + 1)
       .setValues(drop.map(r => [now].concat(asText(r))));

  sheet.getRange(2, 1, lastRow - 1, width).clearContent();
  if (keep.length) sheet.getRange(2, 1, keep.length, width).setValues(keep.map(asText));
  SpreadsheetApp.flush();
  return drop.length;
}

// 🛡️ 題庫異動 JSON 快照（保留最近 200 筆）
function saveConfigSnapshot(roomCode, cfgStr, actionType) {
  try {
    const snapSheet = getSheet("Snapshots", ["timestamp", "roomCode", "actionType", "configJson"]);
    const tz = Session.getScriptTimeZone() || "Asia/Taipei";
    const ts = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
    snapSheet.appendRow([ts, "'" + roomCode, actionType, cfgStr]);
    if (snapSheet.getLastRow() > 205) {
      snapSheet.deleteRows(2, snapSheet.getLastRow() - 201);
    }
  } catch (e) {
    console.error("saveConfigSnapshot failed: " + e);
  }
}

// ---------------------------------------------------------------------------------
// 🧰 管理員一次性工具（在 Apps Script 編輯器手動執行）
// ---------------------------------------------------------------------------------

// 建立雜湊用的 salt，並把 Configs / Snapshots 裡的明碼密碼轉成雜湊、移除題庫中的密碼欄位。
// 可重複執行，已轉換過的資料不會再被改動。執行前建議先手動複製一份試算表備份。
function setupSecurity() {
  const props = PropertiesService.getScriptProperties();
  if (!getProp_("PIN_SALT")) {
    props.setProperty("PIN_SALT", Utilities.getUuid() + Utilities.getUuid());
    PROPS_MEMO_ = null;
  }
  const warnings = [];
  if (!getSuperPass_()) warnings.push("尚未設定 SUPER_ADMIN_PASS（最高管理員將無法登入）");
  if (!getHubId_()) warnings.push("尚未設定 AUTH_HUB_SPREADSHEET_ID（一般老師將無法登入）");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let pins = 0, owners = 0, cfgs = 0, snaps = 0;
  try {
    const sheet = getConfigsSheet();
    const lastRow = sheet.getLastRow();
    const cache = CacheService.getScriptCache();
    if (lastRow >= 2) {
      const range = sheet.getRange(2, 1, lastRow - 1, 6);
      const rows = range.getValues();
      rows.forEach(r => {
        const pin = stripQuote_(r[1]);
        if (pin && pin.indexOf(HASH_PREFIX) !== 0) { r[1] = hashSecret_(pin); pins++; }
        const owner = stripQuote_(r[4]);
        if (owner && owner.indexOf(HASH_PREFIX) !== 0) { r[4] = hashSecret_(owner.toLowerCase()); owners++; }
        try {
          const raw = JSON.parse(r[2] || "{}");
          if (SENSITIVE_CONFIG_KEYS.some(k => k in raw)) { r[2] = JSON.stringify(sanitizeConfig_(raw)); cfgs++; }
        } catch (e) {}
        r[0] = "'" + normCode_(r[0]);
        cache.remove("CFG_" + normCode_(r[0]));
      });
      range.setValues(rows);
    }

    const snapSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Snapshots");
    if (snapSheet && snapSheet.getLastRow() >= 2) {
      const sRange = snapSheet.getRange(2, 4, snapSheet.getLastRow() - 1, 1);
      const sVals = sRange.getValues();
      sVals.forEach(r => {
        try {
          const raw = JSON.parse(r[0] || "{}");
          if (SENSITIVE_CONFIG_KEYS.some(k => k in raw)) { r[0] = JSON.stringify(sanitizeConfig_(raw)); snaps++; }
        } catch (e) {}
      });
      sRange.setValues(sVals);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  const msg = `✅ 安全設定完成：轉換管理密碼 ${pins} 筆、建立者通行碼 ${owners} 筆、清除題庫內密碼 ${cfgs} 筆、快照 ${snaps} 筆。` +
              (warnings.length ? "\n⚠️ " + warnings.join("\n⚠️ ") : "");
  console.log(msg);
  return msg;
}

// 🚚 把另一個試算表（例如逆轉王的舊後端）的代碼與成績搬進這個試算表
// 用法：指令碼屬性新增
//   IMPORT_SOURCE_SPREADSHEET_ID  舊試算表的 ID
//   IMPORT_GAME_LABEL             （選填）舊成績要標記的遊戲名稱，例如 逆轉王
// 然後在編輯器執行 importFromOtherSpreadsheet。同一個來源只能匯入一次。
// ⚠️ 來源試算表請「不要」先執行 setupSecurity，否則密碼已轉成雜湊，無法搬移。
function importFromOtherSpreadsheet() {
  const srcId = getProp_("IMPORT_SOURCE_SPREADSHEET_ID");
  if (!srcId) throw new Error("請先在指令碼屬性新增 IMPORT_SOURCE_SPREADSHEET_ID（舊試算表的 ID）。");
  const doneKey = "IMPORTED_" + srcId;
  if (getProp_(doneKey)) throw new Error("這個來源已在 " + getProp_(doneKey) + " 匯入過，為避免重複，不再匯入。");
  const label = getProp_("IMPORT_GAME_LABEL");
  const srcSS = SpreadsheetApp.openById(srcId);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const imported = [], conflicts = [], hashed = [];
  let scoreCount = 0;
  try {
    const target = getConfigsSheet();
    const existing = new Set(target.getDataRange().getValues().slice(1).map(r => normCode_(r[0])));
    const srcCfg = srcSS.getSheetByName("Configs");
    const newRows = [];
    if (srcCfg) {
      srcCfg.getDataRange().getValues().slice(1).forEach(r => {
        const code = normCode_(r[0]);
        if (!/^\d{5}$/.test(code)) return;
        if (existing.has(code)) { conflicts.push(code); return; }
        const pin = stripQuote_(r[1]), owner = stripQuote_(r[4]);
        if (pin.indexOf(HASH_PREFIX) === 0 || owner.indexOf(HASH_PREFIX) === 0) { hashed.push(code); return; }
        newRows.push(["'" + code, "'" + pin, JSON.stringify(parseConfigCell_(r[2])), r[3] || new Date(), owner ? "'" + owner : "", r[5] || ""]);
        imported.push(code);
        existing.add(code);
      });
    }
    if (newRows.length) target.getRange(target.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);

    // 成績：只搬已成功匯入的代碼，依代碼開頭數字放進對應的 Scores_x
    const wanted = new Set(imported);
    const bySheet = {};
    srcSS.getSheets().forEach(sh => {
      if (!/^Scores(_\d)?$/.test(sh.getName()) || sh.getLastRow() < 2) return;
      sh.getRange(2, 1, sh.getLastRow() - 1, SCORE_HEADERS.length).getValues().forEach(r => {
        const code = normCode_(r[1]);
        if (!wanted.has(code)) return;
        let rank = String(r[9] || "");
        if (label && rank.split("||").length === 5) rank += "||||" + label;
        const row = r.slice();
        row[1] = "'" + code; row[2] = "'" + stripQuote_(r[2]); row[9] = rank;
        const name = getScoreSheetByCode(code).getName();
        (bySheet[name] = bySheet[name] || []).push(row);
      });
    });
    Object.keys(bySheet).forEach(name => {
      const sh = getSheet(name, SCORE_HEADERS), rows = bySheet[name];
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, SCORE_HEADERS.length).setValues(rows);
      scoreCount += rows.length;
    });
    SpreadsheetApp.flush();
    PropertiesService.getScriptProperties().setProperty(doneKey, new Date().toISOString());
  } finally {
    lock.releaseLock();
  }

  const security = setupSecurity();
  const msg = `🚚 匯入完成：代碼 ${imported.length} 組（${imported.join("、") || "無"}）、成績 ${scoreCount} 筆。` +
    (conflicts.length ? `\n⚠️ 以下代碼在這個試算表已存在，未匯入（含其成績）：${conflicts.join("、")}` : "") +
    (hashed.length ? `\n⚠️ 以下代碼的密碼已轉成雜湊，無法搬移：${hashed.join("、")}` : "") +
    "\n" + security;
  console.log(msg);
  return msg;
}

// 📦 每日定時完整備份試算表至 Google Drive（可在觸發條件設定每日凌晨 3 點執行）
function autoBackupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folderName = "阿集老師教學平台_自動備份庫";
  const folders = DriveApp.getFoldersByName(folderName);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

  const tz = Session.getScriptTimeZone() || "Asia/Taipei";
  const dateStr = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd_HHmm");
  DriveApp.getFileById(ss.getId()).makeCopy(`備份_${ss.getName()}_${dateStr}`, folder);

  // 自動清理超過 14 份的舊備份
  const files = folder.getFiles();
  const list = [];
  while (files.hasNext()) list.push(files.next());
  list.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  for (let i = 14; i < list.length; i++) {
    list[i].setTrashed(true);
  }
}
