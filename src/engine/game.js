// 三選一遊戲（prototype）：每個回合開始前出現三個選項（固定牌組中隨機抽出），每個選項調整某個生物或植物的某項數值；
// 遊戲開始後先有一段「觀察期」：讓生態自己跑到第一次穩定（或逾時），玩家只能觀察；之後才出現第 1 回合的選項。
// 選定後生態一直跑到「穩定」（或逾時）才進入下一回合；任何時候有物種滅絕就立刻失敗，全部回合結束仍沒有滅絕就勝利。
// 全是純函式：回傳新 state，不修改傳入物件。遊戲進度存在 state.game，所有隨機都來自 state.rngState（同 seed 可重現）。
import { createRng } from './rng.js?v=a75d2c77';
import { tick } from './tick.js?v=a75d2c77';
import { DEFAULT_PARAMS } from './state.js?v=a75d2c77';
import { ecoHealth, stabilityCheck } from './health.js?v=a75d2c77';

const sp = (s, id) => s.species.find((x) => x.id === id);
const ed = (s, predator, prey) => s.edges.find((e) => e.predator === predator && e.prey === prey);
// 每個 apply(s, f) 把目標數值乘上「實際倍率」f
const onSpecies = (id, field) => (s, f) => { sp(s, id)[field] *= f; };
const onEdge = (predator, prey, field) => (s, f) => { ed(s, predator, prey)[field] *= f; };

// 固定牌組。mult 是基準倍率；實際倍率 = mult ** 強度（params.game.strength，預設 3，所以 +25% 實際約 ×1.95）。之後可再加入環境參數的選項。
export const MODIFIERS = [
  { id: 'rabbit_basal_up', name: '兔：代謝', mult: 1.25, desc: '兔每 Tick 消耗的能量變多，要吃更多才養得活。', apply: onSpecies('rabbit', 'basal') },
  { id: 'rabbit_basal_down', name: '兔：代謝', mult: 0.8, desc: '兔更省能量，較容易存活與繁殖。', apply: onSpecies('rabbit', 'basal') },
  { id: 'deer_basal_up', name: '鹿：代謝', mult: 1.25, desc: '鹿每 Tick 消耗的能量變多。', apply: onSpecies('deer', 'basal') },
  { id: 'mouse_repro_cheap', name: '鼠：繁殖成本', mult: 0.7, desc: '鼠生小孩更便宜，族群會長得更快。', apply: onSpecies('mouse', 'reproCost') },
  { id: 'wolf_repro_cheap', name: '狼：繁殖成本', mult: 0.7, desc: '狼更容易繁殖。', apply: onSpecies('wolf', 'reproCost') },
  { id: 'fox_basal_down', name: '狐：代謝', mult: 0.8, desc: '狐更省能量，較不容易餓死。', apply: onSpecies('fox', 'basal') },
  { id: 'deer_graze_up', name: '鹿：吃草效率', mult: 1.3, desc: '鹿吃草更有效率，對草的壓力變大。', apply: onEdge('deer', 'grass', 'efficiency') },
  { id: 'mouse_seed_up', name: '鼠：吃灌木效率', mult: 1.3, desc: '鼠取食灌木更有效率。', apply: onEdge('mouse', 'bush', 'efficiency') },
  { id: 'fox_hunt_rabbit_up', name: '狐：捕兔效率', mult: 1.3, desc: '狐更容易抓到兔。', apply: onEdge('fox', 'rabbit', 'efficiency') },
  { id: 'wolf_hunt_deer_up', name: '狼：捕鹿效率', mult: 1.3, desc: '狼更容易抓到鹿。', apply: onEdge('wolf', 'deer', 'efficiency') },
  { id: 'rabbit_refuge_down', name: '兔：避難所', mult: 0.6, desc: '兔數量少時更容易被找到，被捕食者追到滅絕的風險上升。', apply: (s, f) => { onEdge('fox', 'rabbit', 'refuge')(s, f); onEdge('wolf', 'rabbit', 'refuge')(s, f); } },
  { id: 'grass_income_down', name: '草：環境收入', mult: 0.75, desc: '草長得慢，能養活的草食動物變少。', apply: onSpecies('grass', 'envInput') },
  { id: 'bush_income_up', name: '灌木：環境收入', mult: 1.3, desc: '灌木長得更旺。', apply: onSpecies('bush', 'envInput') },
  { id: 'grass_capacity_up', name: '草：承載量', mult: 1.3, desc: '草能長到的上限更高。', apply: onSpecies('grass', 'envCapacity') },
];

// 選項的實際倍率與顯示文字（例如「兔：代謝 +95%」）
export function modifierFactor(m, power = 1) {
  return m.mult ** power;
}
export function modifierLabel(m, power = 1) {
  const pct = Math.round((modifierFactor(m, power) - 1) * 100);
  return `${m.name} ${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

// 套用一個選項（實際倍率 = mult ** power），回傳新 state
export function applyModifier(state, id, power = 1) {
  const m = MODIFIERS.find((x) => x.id === id);
  if (!m) throw new Error(`未知的選項：${id}`);
  const next = structuredClone(state);
  m.apply(next, modifierFactor(m, power));
  return next;
}

// （會修改）抽出本回合的選項：從牌組中排除已選過的，不重複地隨機抽 n 個；亂數來自 state.rngState
function drawOffers(s, n) {
  const rng = createRng(s.rngState);
  const used = new Set(s.game.history.map((h) => h.id));
  const pool = MODIFIERS.map((m) => m.id).filter((id) => !used.has(id));
  const offers = [];
  while (offers.length < n && pool.length > 0) offers.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  s.game.offers = offers;
  s.rngState = rng.getState();
}

// （會修改）建立穩定度追蹤：acc／n 累積目前這一段的取樣，buckets 是已完成各段的平均數量
function beginTrack(s) {
  s.game.track = { startTick: s.tick, acc: Object.fromEntries(s.species.map((x) => [x.id, 0])), n: 0, buckets: [], last: null };
}

// 開始一局遊戲：回傳帶有 state.game 的新 state，先進入「觀察期」（執行階段、warmup = true）：生態自己跑到第一次穩定（或逾時），
// 這段時間玩家只能觀察；結束後才進入第 1 回合的選擇階段（見 endRound）
export function startGame(state, params = DEFAULT_PARAMS) {
  const next = structuredClone(state);
  next.game = { round: 1, totalRounds: params.game.rounds, phase: 'running', warmup: true, warmupInfo: null, offers: [], history: [], track: null, result: null };
  beginTrack(next);
  return next;
}

// （會修改）進入本回合的執行階段，並建立穩定度追蹤：acc／n 累積目前這一段的取樣，buckets 是已完成各段的平均數量
function beginRound(s, id) {
  s.game.offers = [];
  s.game.phase = 'running';
  s.game.history.push({ round: s.game.round, id, ticks: null, ended: null });
  beginTrack(s);
}

// 選擇第 index 個選項：套用它，進入本回合的執行階段。不在選擇階段時回傳原 state
export function chooseOffer(state, index, params = DEFAULT_PARAMS) {
  if (!state.game || state.game.phase !== 'choosing' || !state.game.offers[index]) return state;
  const id = state.game.offers[index];
  const next = applyModifier(state, id, params.game.strength ?? 1);
  beginRound(next, id);
  return next;
}

// 結算：沒有任何物種滅絕（數量為 0 且沒有種子）就勝利
export function evaluateGame(state) {
  const extinct = state.species.filter((x) => x.count === 0 && x.seeds === 0).map((x) => x.id);
  return { won: extinct.length === 0, extinct };
}

// 這一回合結束：記錄花了多久與結束原因；最後一回合就結算，否則進入下一回合的選擇階段
function endRound(s, ended, elapsed, params) {
  const g = s.game;
  if (g.warmup) {
    // 觀察期結束：記錄花了多久與結束原因，進入第 1 回合的選擇階段（觀察期有物種滅絕則直接失敗）
    g.warmup = false;
    g.warmupInfo = { ticks: elapsed, ended };
    g.track = null;
    if (ended === 'extinct') {
      g.phase = 'finished';
      g.result = { ...evaluateGame(s), settled: false };
    } else {
      g.phase = 'choosing';
      drawOffers(s, params.game.offersPerRound);
    }
    return s;
  }
  const entry = g.history[g.history.length - 1];
  entry.ticks = elapsed;
  entry.ended = ended;
  g.track = null;
  if (ended === 'extinct' || g.round >= g.totalRounds) {
    g.phase = 'finished';
    g.result = { ...evaluateGame(s), settled: ended === 'settled' };
  } else {
    g.round += 1;
    g.phase = 'choosing';
    drawOffers(s, params.game.offersPerRound);
  }
  return s;
}

// 執行階段前進一個 Tick。依序判定：有物種滅絕 → 立刻失敗；通過穩定度檢查 → 回合結束（settled）；等待超過上限 → 回合結束（timeout）。
// 非執行階段回傳原 state
export function advanceGame(state, params = DEFAULT_PARAMS) {
  if (!state.game || state.game.phase !== 'running') return state;
  const cfg = params.game;
  const next = tick(state, params);
  const tr = next.game.track;
  const elapsed = next.tick - tr.startTick;
  if (elapsed % cfg.sampleEvery === 0) {
    for (const x of next.species) tr.acc[x.id] += x.count;
    tr.n += 1;
  }
  if (next.species.some((x) => x.count === 0 && x.seeds === 0)) return endRound(next, 'extinct', elapsed, params);
  if (elapsed % cfg.checkEveryTicks === 0) {
    tr.buckets.push(Object.fromEntries(Object.entries(tr.acc).map(([id, sum]) => [id, tr.n > 0 ? sum / tr.n : 0])));
    for (const id of Object.keys(tr.acc)) tr.acc[id] = 0;
    tr.n = 0;
    const chk = stabilityCheck(tr.buckets, Math.round(cfg.stableWindowTicks / cfg.checkEveryTicks), cfg.stableTolerance);
    tr.last = chk.ready ? { maxChange: chk.maxChange, worstId: chk.worstId } : null;
    if (chk.stable) return endRound(next, 'settled', elapsed, params);
  }
  if (elapsed >= cfg.maxWaitTicks) return endRound(next, 'timeout', elapsed, params);
  return next;
}

// 把處於執行階段的 state 一路玩到這一回合結束，回傳這一回合的結果：結束原因、花了多久、健康度、各物種起訖數量
function playRound(startState, params) {
  const ids = startState.species.map((x) => x.id);
  const series = Object.fromEntries(ids.map((id) => [id, []]));
  const sample = (s) => s.species.forEach((x) => series[x.id].push(x.count));
  const start = Object.fromEntries(startState.species.map((x) => [x.id, x.count]));
  const t0 = startState.tick;
  let s = startState;
  sample(s);
  for (let guard = 0; s.game.phase === 'running' && guard < 1e6; guard++) {
    s = advanceGame(s, params);
    if ((s.tick - t0) % 10 === 0) sample(s);
  }
  const final = Object.fromEntries(s.species.map((x) => [x.id, x.count]));
  const alive = Object.fromEntries(s.species.map((x) => [x.id, x.count > 0 || x.seeds > 0]));
  const entry = s.game.history[s.game.history.length - 1];
  return { ended: entry.ended, ticks: entry.ticks, health: ecoHealth(series, alive), start, final };
}

// 預覽：把每個選項（以及「什麼都不改」的基準）各自「真的玩完這一回合」，因為直接重用同一套流程（chooseOffer + advanceGame），
// 而且執行階段沒有玩家介入、亂數接續同一條序列，所以預覽結果就是選了之後實際會發生的結果（測試用，之後可改為不完整資訊）。
export function previewOffers(state, params = DEFAULT_PARAMS) {
  const baseState = structuredClone(state);
  beginRound(baseState, null);
  return {
    baseline: playRound(baseState, params),
    options: state.game.offers.map((id, i) => ({ id, ...playRound(chooseOffer(state, i, params), params) })),
  };
}
