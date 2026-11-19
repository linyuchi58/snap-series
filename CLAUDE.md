# 舉牌系列（PopQuiz Snap 家族）維護守則

國小資訊老師原創的「紙本 IRS」：學生舉起旋轉的紙卡作答，老師用手機掃描全班，大電視即時顯示，成績寫入 Google 試算表。
任何修改前請先讀完本檔。

## 檔案

- `games/*.html`：四款遊戲，各自是**單一 HTML 檔**（零建置工具，老師下載一個檔案就能用）。
  秒答樂 `popquiz-snap`、逆轉王 `popquiz-showdown`、攀岩王 `yushan-snap`、甜點派對 `sweet-monster-snap`。
- `gas/Code.gs`：Google Apps Script 後端，各遊戲共用同一份程式。四款舉牌遊戲共用同一個部署（網址開頭 AKfycbwldbgt8JrF），同一個代碼四款通用，成績以 rankTitle 第 7 段（GAME_LABEL）區分遊戲。拖曳分類、泡泡拍打等其他遊戲有各自獨立的後端，不屬於本系列。
- `tests/`：`node tests/code-gs.test.js`（後端，模擬 GAS）、`node tests/e2e-admin.test.js games/*.html` 、`node tests/e2e-phase2.test.js games/*.html`（瀏覽器端對端，含雙機同步）、`node tests/e2e-shared.test.js`（共用後端）。
  每次修改後兩個都要通過。
- `ui/snap-ui.css`、`ui/snap-ui.js`：逆轉王、攀岩王、甜點派對共用的介面層（秒答樂不使用）。
  改完執行 `python3 tools/build_ui.py`，它會把兩個檔案內嵌到三款 HTML 的 `<!-- SNAP-UI:BEGIN/END -->` 之間，並更新版號。
  介面層只搬動與排版既有元素，以 `onclick` 字串與 id 找到按鈕，**不得**在這裡改遊戲邏輯；
  遊戲 HTML 若改了這些按鈕的 onclick 寫法，介面層要跟著改。各遊戲設定（主題色、要自動調整尺寸的畫布）在 `build_ui.py`。
- `tools/`：修補與建置腳本。

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

## 發布（GitHub Pages）

| 遊戲 | GitHub 專案 | 網址 |
| --- | --- | --- |
| 秒答樂 | linyuchi58/popquiz-snap | https://linyuchi58.github.io/popquiz-snap/ |
| 逆轉王 | linyuchi58/popquiz-showdown | https://linyuchi58.github.io/popquiz-showdown/ |
| 攀岩王 | linyuchi58/yushan-snap | https://linyuchi58.github.io/yushan-snap/ |
| 甜點派對 | linyuchi58/sweet-monster-snap | https://linyuchi58.github.io/sweet-monster-snap/ |

本 repo（linyuchi58/snap-series）是原始碼；各遊戲專案只放 `index.html`（＝ `games/<專案名>.html`）與 README。
改版流程：改 `games/` 或 `ui/` → `python3 tools/build_ui.py` → 跑測試 → `tools/publish.sh <clone 資料夾>` → 各專案 commit、push。
遊戲裡的 `DEFAULT_SITE_URL`（手機掃 QR Code 開啟的網址）指向各自的 GitHub Pages 網址；舊的協作平台網址會自動換掉。
老師的其他遊戲（拖曳分類、打地鼠等）各有獨立專案與後端，不屬於本系列；`linyuchi58/game-codes` 是「遊戲代碼公開區」。

## 版本

版號寫在 `APP_VERSION` 與 `<title>`，並記錄於 `CHANGELOG.md`。
