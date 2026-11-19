# 舉牌系列（PopQuiz Snap 家族）維護守則

國小資訊老師原創的「紙本 IRS」：學生舉起旋轉的紙卡作答，老師用手機掃描全班，大電視即時顯示，成績寫入 Google 試算表。
任何修改前請先讀完本檔。

## 檔案

- `games/*.html`：四款遊戲，各自是**單一 HTML 檔**（零建置工具，老師下載一個檔案就能用）。
  秒答樂 `popquiz-snap`、逆轉王 `popquiz-showdown`、攀岩王 `yushan-snap`、甜點派對 `sweet-monster-snap`。
- `gas/Code.gs`：Google Apps Script 後端，四款與其他一般遊戲共用同一份程式（部署在 3 個試算表）。
- `tests/`：`node tests/code-gs.test.js`（後端，模擬 GAS）、`node tests/e2e-admin.test.js games/*.html`（瀏覽器端對端）。
  每次修改後兩個都要通過。
- `tools/`：一次性修補腳本。

## 絕對不可破壞的設計（皆經真實教室實測定案）

1. **光學引擎** `detectMarkersInCanvas`：960×720 畫布、step=1 無損、積分影像自適應二值化門檻 0.87；
   五重防偽（字典 diff===0、Quiet Zone 8 點 ≥75% 白、外框 12 格全黑、黑點 5~11 顆且反差 ≥36、四邊形對稱）。
   時間鎖：首次 0.5 秒、改答案 1.2 秒。配對成功後只在 20 秒配對窗口內解碼配對碼。
   四款遊戲的這個函式必須保持一致。
2. **光學字典** `MARKER_CODES` 與 `SEAT_DIR_PERMUTATIONS`：改動會讓已印出的紙卡全部失效。
3. **雙信箱同步**：電視寫 `T`+配對碼、手機寫 `M`+配對碼；手機絕不傳 `pairCode`；套用遠端狀態必帶 `skipPush=true`。
4. **折紙卡 PDF** `drawOrigamiA4SheetCanvas`：上半正面旋轉 180°、下半背面 0°，畫布 1600×2263。旋轉角度不可改。
5. **百分制計分**：`Math.round(correct / 施測題數 × 100)`。
6. 任何 UI、註解、Metadata 都**不得出現 Plickers 字樣**。

## 安全規則（v3.1 起）

- 程式碼內不放任何密碼或試算表 ID，一律用指令碼屬性（`SUPER_ADMIN_PASS`、`AUTH_HUB_SPREADSHEET_ID`、`PIN_SALT`）。
- 任何會改資料的後端動作都要經過 `requireRoomAuth_`；學生上傳成績與雙機同步除外。
- 題庫 JSON 不得含 `roomPin` 等密碼欄位（`sanitizeConfig_`）；`getRoomConfig` 是公開讀取。
- 後端錯誤一律回傳 `{status:"error", code, message}`；前端要顯示 `message`。

## 版本

版號寫在 `APP_VERSION` 與 `<title>`，並記錄於 `CHANGELOG.md`。
