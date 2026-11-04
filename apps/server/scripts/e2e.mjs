/**
 * 端對端測試：對本機 wrangler dev 建房、2 位真人 + 1 位電腦打完一局，途中測試斷線重連。
 * 用法：先啟動 `npx wrangler dev --var BOT_DELAY_SCALE:0.05`，再執行 `node scripts/e2e.mjs [baseUrl]`
 * 真人客戶端只看自己收到的視角做決定，用來確認協定資訊足夠。
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const TIMEOUT_MS = 240_000;

function log(...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

class Client {
  constructor(name) {
    this.name = name;
    this.view = null;
    this.room = null;
    this.errors = [];
    this.token = null;
    this.playerId = null;
    this.stateCount = 0;
  }

  connect(code) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/parties/room/${code}`);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`${this.name} 連線失敗 ${e.message ?? ''}`));
      this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'joined':
        this.token = msg.token;
        this.playerId = msg.playerId;
        break;
      case 'room':
        this.room = msg;
        break;
      case 'state':
        this.view = msg.view;
        this.stateCount += 1;
        this.decide();
        break;
      case 'error':
        // 時序競爭造成的「現在不能這樣做」可以接受，其他錯誤記錄下來
        if (!['wrongPhase', 'notYourTurn'].includes(msg.code)) this.errors.push(msg);
        break;
    }
  }

  act(action) {
    this.send({ type: 'action', action });
  }

  decide() {
    const v = this.view;
    if (!v || v.phase !== 'playing' || !v.prompt || !v.players[v.you].alive) return;
    const p = v.prompt;
    const me = v.you;
    switch (p.kind) {
      case 'draw':
        if (p.player === me) this.act({ type: 'draw' });
        break;
      case 'play': {
        if (p.player !== me) break;
        const creature = v.hand.find((c) => SPECIES.has(c.kind));
        if (creature) return this.act({ type: 'play', cards: [creature.id] });
        const simple = v.hand.find((c) => ['wave', 'reverse', 'chef', 'watchout', 'salmon'].includes(c.kind));
        if (simple) return this.act({ type: 'play', cards: [simple.id] });
        const targeted = v.hand.find((c) => c.kind === 'steal' || c.kind === 'switch');
        const target = v.players.findIndex((pl, i) => i !== me && pl.alive && pl.handCount > 0);
        if (targeted && target >= 0) this.act({ type: 'play', cards: [targeted.id], target });
        break;
      }
      case 'placePuffer':
        if (p.player === me) this.act({ type: 'placePuffer', position: 0 });
        break;
      case 'response':
        if (!p.declinedByYou) this.act({ type: 'decline' });
        break;
      case 'fisher':
        if (p.player === me && p.cards) {
          const ids = p.cards.map((c) => c.id);
          this.act({ type: 'fisherChoose', keep: ids.slice(0, 3), returnOrder: ids.slice(3) });
        }
        break;
      case 'chef':
        if (p.player === me && p.cards) {
          const ids = p.cards.map((c) => c.id);
          this.act({ type: 'chefArrange', keep: ids[0], order: ids.slice(1) });
        }
        break;
      case 'slap':
        if (p.players.includes(me) && !p.slappedByYou) setTimeout(() => this.act({ type: 'slap' }), 50);
        break;
    }
  }
}

const SPECIES = new Set([
  'clownfish', 'dolphin', 'seal', 'stingray', 'jellyfish',
  'isopod', 'barreleye', 'catshark', 'sacabambaspis', 'anglerfish',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error(`等待逾時：${label}`);
}

function assert(cond, label) {
  if (!cond) throw new Error(`檢查失敗：${label}`);
  log('✓', label);
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  assert(health.ok === true, '伺服器健康檢查');

  const bad = await fetch(`${BASE}/parties/room/abc`);
  assert(bad.status === 404, '錯誤格式的房號被拒絕');

  const { code } = await fetch(`${BASE}/api/rooms`, { method: 'POST' }).then((r) => r.json());
  assert(/^[A-Z2-9]{6}$/.test(code), `建立房間，房號 ${code}`);

  const ghost = new Client('ghost');
  await ghost.connect('ZZZZZZ');
  await sleep(300);
  assert(ghost.ws.readyState !== WebSocket.OPEN, '不存在的房間會關閉連線');

  const a = new Client('A');
  const b = new Client('B');
  await a.connect(code);
  a.send({ type: 'join', name: '阿明' });
  await waitFor(() => a.token, 'A 加入');
  await b.connect(code);
  b.send({ type: 'join', name: '小華' });
  await waitFor(() => b.token && a.room?.seats.length === 2, 'B 加入');
  a.send({ type: 'addBot' });
  await waitFor(() => a.room?.seats.length === 3, '加入電腦');
  assert(a.room.hostId === a.playerId, 'A 是房主');

  a.send({ type: 'start' });
  await waitFor(() => a.view && b.view, '開局');
  assert(a.view.hand.length >= 7 && b.view.you === 1, '開局後各自收到視角');

  // 打一陣子後讓 B 斷線再重連
  await waitFor(() => a.view.turnCount >= 6 || a.view.phase === 'ended', '進行數回合', 60_000);
  if (a.view.phase === 'playing' && b.view.players[1].alive) {
    const token = b.token;
    b.ws.close();
    await sleep(300);
    const b2 = new Client('B2');
    await b2.connect(code);
    b2.send({ type: 'join', name: '', token });
    await waitFor(() => b2.view, 'B 重新連線收到局面');
    assert(b2.playerId === b.playerId && b2.view.you === 1, 'B 用 token 回到原座位');
    Object.assign(b, { ws: b2.ws, view: b2.view });
    b2.onMessage = (msg) => Client.prototype.onMessage.call(b, msg);
    b.decide();
  } else {
    log('（遊戲太快結束或 B 已淘汰，略過重連測試）');
  }

  await waitFor(() => a.view.phase === 'ended', '整局結束', TIMEOUT_MS);
  const winner = a.view.players[a.view.winner];
  assert(true, `遊戲結束：${winner.name} 以 ${a.view.winReason === 'collection' ? '收集' : '存活'} 獲勝，共 ${a.view.turnCount} 回合`);
  await waitFor(() => a.room?.phase === 'ended', '房間狀態變成 ended');
  assert(a.errors.length === 0 && b.errors.length === 0, `沒有非預期錯誤 ${JSON.stringify([...a.errors, ...b.errors])}`);

  a.send({ type: 'rematch' });
  await waitFor(() => a.room?.phase === 'lobby', '再來一局回到大廳');
  assert(true, '再來一局回到大廳');

  a.ws.close();
  b.ws.close();
  log('全部通過');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
