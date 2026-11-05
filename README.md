# 河豚愛生氣 線上版

《河豚愛生氣》卡牌遊戲的網頁多人版。3～5 人用 6 碼邀請碼開房，不需要帳號，手機和電腦都能玩，也可以加入電腦玩家。

## 共同創作者

《河豚愛生氣》原作共同創作者：

- [@HuangYu-Kai](https://github.com/HuangYu-Kai)
- [@XuanOuO](https://github.com/XuanOuO)

線上版開發：[@BoYoOUO-0924](https://github.com/BoYoOUO-0924)

## 特色

- 完整實作原版規則：生氣的河豚與 Chill、No way／Pass 回應時間（6 秒）、Watch Out 搶拍、漁網／漁販／魚雷組合技、收集勝利
- **深海變體**：先出牌再抽牌、可連續出牌，單張生物有效果（浮潛、深潛），組合技改為拖網、魚雷、聲納，由房主在等待室選擇
- 電腦玩家（原版與深海變體各有一套）
- 斷線後可以重新連回
- 所有動作都有動畫與合成音效

規則細節請看 [docs/規則規格書.md](docs/規則規格書.md)，技術架構請看 [docs/技術架構.md](docs/技術架構.md)。

## 專案結構

```
packages/engine/     規則引擎（純 TypeScript 狀態機）、電腦玩家、測試
packages/protocol/   前端與伺服器之間的訊息格式
apps/server/         Cloudflare Workers + Durable Objects 房間伺服器
apps/web/            React 前端（Vite）
docs/                規格文件
```

## 本機開發

需要 Node.js 20 以上。

```bash
npm install
```

開兩個終端機，分別啟動房間伺服器（port 8787）和網頁（port 5173）：

```bash
npm run dev:server
```

```bash
npm run dev:web
```

打開 http://localhost:5173 就能開房。

## 測試

```bash
npm test
```

```bash
npm run typecheck
```
