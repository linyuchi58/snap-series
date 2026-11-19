# 舉牌系列（PopQuiz Snap 家族）

學生不需要平板或手機，只要舉起紙卡、轉到想選的方向；老師用手機掃描全班，大電視即時顯示作答與正解，成績自動寫入 Google 試算表。

阿集電腦教室原創設計。

| 遊戲 | 檔案 | 版本 |
| --- | --- | --- |
| 舉牌秒答樂 PopQuiz Snap! | `games/popquiz-snap.html` | v2.9.1 |
| 舉牌逆轉王 PopQuiz Showdown! | `games/popquiz-showdown.html` | v1.3.1 |
| 巔峰攀岩王 Yushan Snap! | `games/yushan-snap.html` | v1.4.1 |
| 舉牌甜點大派對 Sweet Monster Snap! | `games/sweet-monster-snap.html` | v1.2.1 |

- 線上版：https://linyuchi58.github.io/popquiz-snap/ 、/popquiz-showdown/ 、/yushan-snap/ 、/sweet-monster-snap/
- 後端：`gas/Code.gs`，四款共用同一個部署（部署方式見 `docs/DEPLOY-v3.1.md`）
- 介面層：`ui/`（修改後執行 `python3 tools/build_ui.py` 內嵌進三款遊戲）
- 維護守則：`CLAUDE.md`
- 更新紀錄：`CHANGELOG.md`

## 測試

```
node tests/code-gs.test.js
node tests/e2e-admin.test.js games/*.html   # 需要 Playwright
node tests/e2e-phase2.test.js games/*.html
node tests/e2e-shared.test.js
node tests/e2e-ui.test.js games/popquiz-showdown.html games/yushan-snap.html games/sweet-monster-snap.html
```
