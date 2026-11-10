// UI 主程式：建立 SVG、綁定按鈕、以計時器驅動 engine。只讀 state，操作時呼叫 engine。
import { DEFAULT_PARAMS, createInitialState, spawn, setCount } from '../engine/state.js?v=2bde8609';
import { tick } from '../engine/tick.js?v=2bde8609';
import { foodShare, hungerRatio, getSpecies, selfSufficiency, edgeEnergyFlows, seasonFactor } from '../engine/derived.js?v=2bde8609';
import { hasSeedBank, isStaged, juvenileCount } from '../engine/ages.js?v=2bde8609';
import { ageRingCells, ringGeometry, edgeVisual, pickLabelPoint } from './viz.js?v=2bde8609';
import { MODIFIERS, modifierLabel, startGame, chooseOffer, advanceGame, previewOffers } from '../engine/game.js?v=2bde8609';
import { buildRecord } from './record.js?v=2bde8609';
import { BUILD } from '../version.js?v=2bde8609';
import { createHistory, recordSample, addMarker, setReferenceEnd } from './history.js?v=2bde8609';
import { drawChart, SPECIES_COLORS } from './chart.js?v=2bde8609';

const SVG_NS = 'http://www.w3.org/2000/svg';
const params = DEFAULT_PARAMS;

// 節點位置（畫面佈局，非模擬數值）
// 依營養層級分三排：下排生產者、中排草食者、上排肉食者
const NODE_POS = {
  grass: { x: 170, y: 456 }, bush: { x: 550, y: 456 },
  mouse: { x: 90, y: 266 }, rabbit: { x: 290, y: 266 }, deer: { x: 520, y: 266 },
  fox: { x: 190, y: 76 }, wolf: { x: 470, y: 76 },
};
const NODE_RADIUS = 32;
const RING_RADIUS = NODE_RADIUS + 9; // 年齡環（小圓圈）的半徑
const RING_OUT = RING_RADIUS + 4; // 節點含年齡環的外緣，標籤、能量條、箭頭端點都以此為準
const MAX_RING_DOTS = 36; // 年齡格太多時，相鄰格合併，最多顯示這麼多個小圓圈
const COLORS = { producer: '#2f8f4e', consumer: '#c0392b' };
const JUVENILE_COLOR = '#2f80ed'; // 年齡環：幼年格
const ADULT_COLOR = '#f59e0b'; // 年齡環：成年格
// 每個節點「佔用」的矩形（含年齡環、名稱、能量條與兩行小字），百分比標籤會自動避開
const NODE_RECTS = Object.values(NODE_POS).map(({ x, y }) => ({ x0: x - 60, x1: x + 60, y0: y - RING_OUT - 18, y1: y + RING_OUT + 4 + 8 + 30 }));
const BAR_WIDTH = 70;
const BAR_HEIGHT = 8;

// 網址參數：?seed=種子（預設用 params.defaultSeed）；?picks=1,0,2 自動依序選第幾個選項（用來重現測試者的那一局）
const urlParams = new URLSearchParams(location.search);
const GAME_SEED = urlParams.get('seed') !== null && Number.isFinite(Number(urlParams.get('seed'))) ? Number(urlParams.get('seed')) : params.defaultSeed;
const PICKS = urlParams.get('picks') ? urlParams.get('picks').split(',').map(Number) : null;
let pickLog = []; // 這局每回合玩家選了第幾個選項、當時提示是否開啟：[{ round, index, hint }]

let state = createInitialState(params, GAME_SEED);

// ---- 數量變化圖的歷史資料（放在畫面層，不放進引擎 state；見 history.js） ----
let history = createHistory(state.species.map((x) => x.id));
let markedWarmup = false; // 是否已標記觀察期結束
let markedEnds = 0; // 已標記幾個回合結束
let markedExtinct = false;
let chartMode = 'relative'; // 縱軸：'relative'（相對平常的倍數）或 'raw'（原始數量）
let chartRange = 'all'; // 'all' 或最近這麼多 Tick
let chartHover = null; // 滑鼠所在的 tick
const chartHidden = new Set(); // 被隱藏的物種
let chartLen = -1; // 上次畫圖時的取樣點數
let captionLen = -1; // 上次顯示事件清單時的標記數
let chartDrawnAt = 0;
let chartDirty = true;
const RECENT_TICKS = 8000;
let paused = false;
let speed = 1; // 可用網址參數指定初始倍速，例如 ?speed=100
let speedLocked = false; // 玩家是否手動指定過速度：指定過就不再被遊戲自動改掉
let timer = null;
let gameMode = false; // 三選一遊戲模式（網址參數 ?mode=game 可直接開始）
let previewCache = null; // { round, data }：本回合各選項的預覽，避免重複計算
let hintOn = new URLSearchParams(location.search).get('hint') === '1'; // 提示：是否顯示預測結果。預設隱藏（網址 ?hint=1 一開始就顯示）
let panelKey = ''; // 目前遊戲面板對應的 階段+回合，變了才重建

const $ = (id) => document.getElementById(id);

// 大數字縮寫：1234 → 1.2k、1500000 → 1.50M
function formatCount(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0) + 'k';
  return (n / 1e6).toFixed(2) + 'M';
}
const svg = $('graph');

function el(name, attrs = {}, parent = svg) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}

// ---- 建立靜態 SVG 結構，之後只更新屬性 ----
const defs = el('defs');
const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto-start-reverse' }, defs);
el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#9aa0a6' }, marker);

// 每條邊：底線（細灰線 + 箭頭，方向為 捕食者 → 獵物）、能量線（發光的流動虛線，亮點由獵物流向捕食者）、百分比標籤
const edgeEls = state.edges.map((e) => ({
  edge: e,
  base: el('line', { stroke: '#9aa0a6', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'marker-end': 'url(#arrow)' }),
  glow: el('line', { class: 'energy-line', 'stroke-width': 3.2, opacity: 0 }),
  label: el('text', { class: 'bar-text' }),
  glowKey: '', // 上次套用的發光與動畫設定，避免每次重繪都重設而讓動畫重新開始
  durKey: '',
}));

const nodeEls = {};
for (const s of state.species) {
  const { x, y } = NODE_POS[s.id];
  const g = el('g');
  // 年齡環：只有有年齡結構的物種才有。圓圈從正上方順時針排列，年齡由小到大
  let ring = null;
  if (isStaged(s)) {
    const cells = ageRingCells(s.ages, s.matureBin, MAX_RING_DOTS);
    el('circle', { cx: x, cy: y, r: RING_RADIUS, fill: 'none', stroke: '#e6e6e6', 'stroke-width': 0.6 }, g);
    ring = ringGeometry(cells.length, RING_RADIUS).map((d) => {
      const dot = el('circle', { cx: x + d.x, cy: y + d.y, r: d.r, stroke: '#888', 'stroke-width': 0.5, 'fill-opacity': 0.1 }, g);
      const title = el('title', {}, dot);
      return { dot, title };
    });
  }
  const body = el('circle', { cx: x, cy: y, r: NODE_RADIUS, fill: COLORS[s.kind] }, g);
  el('text', { x, y, class: 'node-count' }, g);
  el('text', { x, y: y - RING_OUT - 6, class: 'node-label' }, g).textContent = s.label;
  const barY = y + RING_OUT + 4;
  el('rect', { x: x - BAR_WIDTH / 2, y: barY, width: BAR_WIDTH, height: BAR_HEIGHT, fill: '#ddd', rx: 3 }, g);
  const fill = el('rect', { x: x - BAR_WIDTH / 2, y: barY, width: 0, height: BAR_HEIGHT, rx: 3 }, g);
  // 餓死警戒線標記
  const lineX = x - BAR_WIDTH / 2 + BAR_WIDTH * params.starveLine;
  el('line', { x1: lineX, x2: lineX, y1: barY - 2, y2: barY + BAR_HEIGHT + 2, stroke: '#333', 'stroke-width': 1 }, g);
  const barText = el('text', { x, y: barY + BAR_HEIGHT + 14, class: 'bar-text' }, g);
  const supplyText = el('text', { x, y: barY + BAR_HEIGHT + 26, class: 'bar-text' }, g);
  nodeEls[s.id] = { g, body, countText: g.querySelector('.node-count'), fill, barText, supplyText, ring };
}

// 邊的端點：沿圓心連線，各縮進到節點（含年齡環）外緣（只畫在圓外）
function edgeEndpoints(predatorId, preyId) {
  const a = NODE_POS[predatorId];
  const b = NODE_POS[preyId];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const pad = RING_OUT + 2;
  return { x1: a.x + ux * pad, y1: a.y + uy * pad, x2: b.x - ux * (pad + 6), y2: b.y - uy * (pad + 6) };
}

// ---- 數量變化圖 ----
function sampleHistory() {
  recordSample(history, state.tick, Object.fromEntries(state.species.map((x) => [x.id, x.count])));
}

function resetHistory() {
  history = createHistory(state.species.map((x) => x.id));
  markedWarmup = false;
  markedEnds = 0;
  markedExtinct = false;
  chartLen = -1;
  chartDirty = true;
  sampleHistory();
  renderChartCaption(true);
}

// 依遊戲進度加事件標記：觀察期結束（並把「平常」的參考期間設到這裡）、回合結束、滅絕
function syncGameMarkers() {
  const g = state.game;
  if (!g) return;
  if (g.warmupInfo && !markedWarmup) {
    markedWarmup = true;
    setReferenceEnd(history, state.tick);
    addMarker(history, { type: 'warmup', tick: state.tick, label: `觀察期結束（${g.warmupInfo.ticks} Tick 後${g.warmupInfo.ended === 'settled' ? '穩定' : '逾時'}）` });
  }
  while (markedEnds < g.history.length && g.history[markedEnds].ended !== null) {
    const e = g.history[markedEnds];
    if (e.ended !== 'extinct') addMarker(history, { type: 'end', tick: state.tick, label: `第 ${e.round} 回合結束（${e.ended === 'settled' ? `${e.ticks} Tick 後穩定` : `${e.ticks} Tick 仍未穩定`}）` });
    markedEnds++;
  }
  if (g.phase === 'finished' && g.result && g.result.extinct.length && !markedExtinct) {
    markedExtinct = true;
    for (const id of g.result.extinct) addMarker(history, { type: 'extinct', tick: state.tick, speciesId: id, label: `${state.species.find((x) => x.id === id).label}滅絕` });
  }
  chartDirty = true;
  renderChartCaption();
}

// 圖下方的事件清單（和圖上的編號對應）
function renderChartCaption(force = false) {
  const box = $('chartCaption');
  if (!box || (!force && history.markers.length === captionLen)) return;
  captionLen = history.markers.length;
  box.replaceChildren();
  for (const m of history.markers) {
    const line = document.createElement('div');
    line.textContent = `${m.type === 'pick' ? `● ${m.n}` : m.type === 'extinct' ? '✕' : '┆'} Tick ${m.tick}　${m.label}`;
    if (m.type === 'pick') line.style.color = '#1976d2';
    if (m.type === 'extinct') line.style.color = '#c62828';
    box.appendChild(line);
  }
}

// 只有面板展開時才畫；有新資料才重畫，而且最多每 150 毫秒一次（模擬一個 Tick 約 0.3 毫秒，重畫 < 1 毫秒，但沒必要每個畫面都畫）
function updateChart(force = false) {
  const panel = $('chartPanel');
  if (!panel || !panel.open) return;
  const now = performance.now();
  if (!force && !chartDirty && history.ticks.length === chartLen) return;
  if (!force && now - chartDrawnAt < 150) return;
  chartLen = history.ticks.length;
  chartDirty = false;
  chartDrawnAt = now;
  drawChart($('chartCanvas'), history, { mode: chartMode, range: chartRange, hidden: chartHidden, labels: Object.fromEntries(state.species.map((x) => [x.id, x.label])), hoverTick: chartHover });
}

function setupChartControls() {
  const legend = $('chartLegend');
  for (const sp of state.species) {
    const chip = document.createElement('button');
    chip.className = 'legend-chip';
    chip.textContent = sp.label;
    chip.style.borderColor = SPECIES_COLORS[sp.id] ?? '#333';
    chip.addEventListener('click', () => {
      chartHidden.has(sp.id) ? chartHidden.delete(sp.id) : chartHidden.add(sp.id);
      chip.classList.toggle('off', chartHidden.has(sp.id));
      updateChart(true);
    });
    legend.appendChild(chip);
  }
  $('chartMode').addEventListener('click', () => {
    chartMode = chartMode === 'relative' ? 'raw' : 'relative';
    $('chartMode').textContent = chartMode === 'relative' ? '縱軸：相對倍數' : '縱軸：原始數量';
    updateChart(true);
  });
  $('chartRange').addEventListener('click', () => {
    chartRange = chartRange === 'all' ? RECENT_TICKS : 'all';
    $('chartRange').textContent = chartRange === 'all' ? '時間：全部' : `時間：最近 ${RECENT_TICKS} Tick`;
    updateChart(true);
  });
  const cv = $('chartCanvas');
  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect();
    const plotLeft = 50;
    const plotW = r.width - 50 - 12;
    const win = chartRange === 'all' ? [history.ticks[0] ?? 0, history.ticks[history.ticks.length - 1] ?? 1] : [Math.max(0, (history.ticks[history.ticks.length - 1] ?? 0) - chartRange), history.ticks[history.ticks.length - 1] ?? 1];
    const frac = (e.clientX - r.left - plotLeft) / plotW;
    chartHover = frac < 0 || frac > 1 ? null : win[0] + frac * (win[1] - win[0]);
    updateChart(true);
  });
  cv.addEventListener('mouseleave', () => { chartHover = null; updateChart(true); });
  $('chartPanel').addEventListener('toggle', () => updateChart(true));
  window.addEventListener('resize', () => updateChart(true));
}

// ---- 繪製 ----
function render() {
  $('tickNum').textContent = state.tick;
  $('winTicks').textContent = params.winTicks;
  $('winWrap').hidden = params.godMode;
  $('pointsWrap').hidden = params.godMode;
  $('points').textContent = state.points;
  const st = $('status');
  st.className = state.status;
  st.textContent = gameMode ? '三選一遊戲' : params.godMode ? '上帝模式' : { playing: '進行中', won: '勝利！', lost: '失敗' }[state.status];

  // 季節指示（進度條 + 百分比）；植物節點的明暗跟著季節變（旺季亮、淡季暗）
  const season = seasonFactor(state.tick, params);
  const amp = params.seasonAmplitude;
  $('seasonWrap').hidden = !amp;
  const seasonPos = amp ? (season - (1 - amp)) / (2 * amp) : 0.5; // 0 = 最淡、1 = 最旺
  $('seasonFill').style.width = `${Math.round(seasonPos * 100)}%`;
  $('seasonFill').style.background = `hsl(${Math.round(40 + 80 * seasonPos)} 55% 48%)`;
  $('seasonText').textContent = `${season > 1.05 ? '旺季' : season < 0.95 ? '淡季' : '平季'} ${Math.round(season * 100)}%`;

  for (const s of state.species) {
    const n = nodeEls[s.id];
    n.countText.textContent = formatCount(s.count);
    if (s.kind === 'producer') n.body.setAttribute('fill', `hsl(138 52% ${Math.round(24 + 18 * seasonPos)}%)`);
    n.g.setAttribute('opacity', s.count === 0 && !s.introduced ? 0.25 : 1);
    const ratio = hungerRatio(s);
    const shown = ratio === null ? 0 : Math.min(1, ratio);
    n.fill.setAttribute('width', BAR_WIDTH * shown);
    n.fill.setAttribute('fill', ratio !== null && ratio < params.starveLine ? '#e67e22' : '#3498db');
    n.barText.textContent = ratio === null ? '—' : `能量 ${Math.round(ratio * 100)}%`;
    // 自給率：預期收入 ÷ 代謝需求。< 100% 表示入不敷出（捕食者「獵物很多卻餓死」多半是這個）
    const sup = selfSufficiency(s, state, params);
    const juvText = isStaged(s) && s.count > 0 ? ` · 幼 ${Math.round((100 * juvenileCount(s)) / s.count)}%` : '';
    const seedText = hasSeedBank(s) ? ` · 種子 ${formatCount(s.seeds)}` : '';
    n.supplyText.textContent = sup === null ? (seedText ? seedText.slice(3) : '') : `自給 ${Math.round(sup * 100)}%${juvText}${seedText}`;
    n.supplyText.setAttribute('fill', sup !== null && sup < 1 ? '#c0392b' : '#555');

    // 年齡環：幼年藍、成年金；填色亮暗 = 該格人數相對於最多那格的比例
    if (n.ring) {
      const cells = ageRingCells(s.ages, s.matureBin, MAX_RING_DOTS);
      cells.forEach((c, i) => {
        const { dot, title } = n.ring[i];
        dot.setAttribute('fill', c.juvenile ? JUVENILE_COLOR : ADULT_COLOR);
        dot.setAttribute('fill-opacity', (0.06 + 0.94 * c.brightness ** 1.5).toFixed(3)); // 加 1.5 次方拉開亮暗對比
        const from = c.from * params.ageBinTicks;
        const to = (c.to + 1) * params.ageBinTicks;
        title.textContent = `${c.juvenile ? '幼年' : '成年'} · 年齡約 ${from}～${to} Tick：${formatCount(c.sum)} 隻（占 ${(c.share * 100).toFixed(1)}%）`;
      });
    }
  }

  // 食物鏈箭頭：顏色／發光強度 = 占捕食者食物來源的比例；能量點移動速度 = 該邊能量流量（相對於流量最大的邊）
  const energy = edgeEnergyFlows(state);
  const maxEnergy = energy.reduce((m, x) => Math.max(m, x), 0);
  edgeEls.forEach((item, i) => {
    const { edge, base, glow, label } = item;
    const p = edgeEndpoints(edge.predator, edge.prey);
    const share = foodShare(edge, state); // 此邊占捕食者食物能量來源的比例
    const vis = edgeVisual(share, maxEnergy > 0 ? energy[i] / maxEnergy : 0);
    for (const line of [base, glow]) {
      line.setAttribute('x1', p.x1);
      line.setAttribute('y1', p.y1);
      line.setAttribute('x2', p.x2);
      line.setAttribute('y2', p.y2);
    }
    const lp = pickLabelPoint(p, NODE_RECTS); // 避開節點文字區
    label.setAttribute('x', lp.x);
    label.setAttribute('y', lp.y);
    label.textContent = `${Math.round(share * 100)}%`;
    const active = getSpecies(state, edge.predator).count > 0 && getSpecies(state, edge.prey).count > 0;
    base.setAttribute('opacity', active ? 1 : 0.25);

    if (vis.dashSeconds === null) {
      glow.setAttribute('opacity', 0);
    } else {
      glow.setAttribute('opacity', vis.opacity.toFixed(2));
      glow.setAttribute('stroke', vis.color);
      const glowKey = `${vis.glowPx.toFixed(1)}|${vis.color}`;
      if (glowKey !== item.glowKey) {
        item.glowKey = glowKey;
        glow.style.filter = `drop-shadow(0 0 ${vis.glowPx.toFixed(1)}px ${vis.color})`;
      }
      const durKey = vis.dashSeconds.toFixed(1);
      if (durKey !== item.durKey) {
        item.durKey = durKey;
        glow.style.animationDuration = `${durKey}s`;
      }
    }
  });

  for (const [id, input] of Object.entries(countInputs)) {
    if (document.activeElement !== input) input.value = getSpecies(state, id).count;
  }
  for (const [id, btn] of Object.entries(spawnBtns)) {
    btn.disabled = state.status !== 'playing' || state.points < params.spawn[id].cost;
  }
  $('pauseBtn').textContent = paused ? '繼續' : '暫停';
  if (gameMode) updateGameStatus();
  updateChart();
  for (const [s, b] of Object.entries(speedBtns)) b.classList.toggle('active', Number(s) === speed);
}

// ---- 控制 ----
const spawnBtns = {}; // 一般模式：花點數投放
const countInputs = {}; // 上帝模式：直接設定數量

if (params.godMode) {
  for (const sp of state.species) {
    const row = document.createElement('div');
    row.className = 'god-row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = sp.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.max = params.godMaxCount;
    input.addEventListener('change', () => {
      state = setCount(state, sp.id, Number(input.value), params);
      render();
    });
    countInputs[sp.id] = input;
    row.appendChild(name);
    for (const d of [-10, -1]) row.appendChild(deltaButton(sp.id, d * params.godStep));
    row.appendChild(input);
    for (const d of [1, 10]) row.appendChild(deltaButton(sp.id, d * params.godStep));
    $('godPanel').appendChild(row);
  }
} else {
  const box = document.createElement('div');
  box.className = 'row';
  for (const sp of state.species) {
    const cfg = params.spawn[sp.id];
    const b = document.createElement('button');
    b.textContent = `${sp.label} ×${formatCount(cfg.amount)}（${cfg.cost} 點）`;
    b.addEventListener('click', () => {
      state = spawn(state, sp.id, params);
      render();
    });
    box.appendChild(b);
    spawnBtns[sp.id] = b;
  }
  $('godPanel').appendChild(box);
}

function deltaButton(id, delta) {
  const b = document.createElement('button');
  b.textContent = (delta > 0 ? '+' : '−') + formatCount(Math.abs(delta));
  b.addEventListener('click', () => {
    state = setCount(state, id, getSpecies(state, id).count + delta, params);
    render();
  });
  return b;
}


// ---- 三選一遊戲 ----
const strength = params.game.strength ?? 1;
const AUTOPICK = new URLSearchParams(location.search).get('autopick') === '1';
const labelOf = (id) => state.species.find((x) => x.id === id).label;
const modOf = (id) => MODIFIERS.find((m) => m.id === id);
const pctText = (v) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function startGameMode() {
  gameMode = true;
  paused = false;
  previewCache = null;
  pickLog = [];
  state = startGame(createInitialState(params, GAME_SEED), params);
  $('godPanel').hidden = true;
  $('gamePanel').hidden = false;
  $('gameBtn').textContent = '回到上帝模式';
  resetHistory();
  render();
  renderGamePanel();
}

function exitGameMode() {
  gameMode = false;
  paused = false;
  state = createInitialState(params, GAME_SEED);
  $('godPanel').hidden = false;
  $('gamePanel').hidden = true;
  $('gameBtn').textContent = '三選一遊戲';
  resetHistory();
  render();
}

// 「複製這局紀錄」：產生一段文字（種子、每回合選了什麼、怎麼結束、目前各物種數量、重現網址），測試者貼回來就能完整重現
function appendRecordBlock(panel) {
  const box = h('div', 'record');
  const btn = h('button', '', '📋 複製這局紀錄');
  const note = h('span', 'game-note', '');
  const ta = h('textarea', 'record-text');
  ta.readOnly = true;
  ta.hidden = true;
  ta.rows = 8;
  btn.addEventListener('click', async () => {
    const text = buildRecord({ state, pickLog, seed: GAME_SEED, build: BUILD, url: location.origin + location.pathname, strength, hintOn });
    ta.value = text;
    ta.hidden = false;
    try {
      await navigator.clipboard.writeText(text);
      note.textContent = ' 已複製，貼給開發者就好';
    } catch {
      ta.select();
      note.textContent = ' 無法自動複製，請手動全選下方文字再複製';
    }
  });
  box.append(btn, note, ta);
  panel.appendChild(box);
}

// 預覽與結果中「這回合怎麼結束」的說明
function endedText(o) {
  if (o.ended === 'extinct') return `⚠ ${o.ticks} Tick 時有物種滅絕，遊戲立刻結束`;
  if (o.ended === 'timeout') return `⏱ 等了 ${o.ticks} Tick（上限）仍未穩定`;
  return `⏱ 約 ${o.ticks} Tick 後穩定`;
}

// 執行階段：只更新等待進度與穩定度文字，不重建整個面板
function updateGameStatus() {
  const g = state.game;
  const el2 = $('gameRemain');
  if (!el2 || g.phase !== 'running' || !g.track) return;
  const cfg = params.game;
  const elapsed = state.tick - g.track.startTick;
  const last = g.track.last;
  const stableText = last
    ? `目前各物種平均值最大變動 ${last.maxChange === Infinity ? '∞' : Math.round(last.maxChange * 100) + '%'}（${labelOf(last.worstId)}），需 ≤ ${Math.round(cfg.stableTolerance * 100)}% 才算穩定`
    : `累積資料中（至少要 ${2 * cfg.stableWindowTicks} Tick 才能判定穩定）`;
  const head = g.warmup ? '觀察期：先讓生態自己跑到第一次穩定，才會出現第 1 回合的選項' : `第 ${g.round} / ${g.totalRounds} 回合：等待生態穩定中`;
  el2.textContent = `${head}，已等 ${elapsed} / 最多 ${cfg.maxWaitTicks} Tick。${stableText}。`;
  const bar = $('gameProgress');
  if (bar) bar.style.width = `${Math.min(100, (100 * elapsed) / cfg.maxWaitTicks)}%`;
}

// 依階段重建遊戲面板：選擇階段顯示三張卡片（含預覽），執行階段顯示進度，結束後顯示勝負
function renderGamePanel() {
  const g = state.game;
  panelKey = `${g.phase}-${g.round}`;
  const panel = $('gamePanel');
  panel.replaceChildren();
  panel.appendChild(h('div', 'game-head', g.warmup || (g.phase === 'finished' && g.history.length === 0) ? '三選一遊戲 · 觀察期' : `三選一遊戲 · 第 ${Math.min(g.round, g.totalRounds)} / ${g.totalRounds} 回合`));

  if (g.phase === 'choosing') {
    const cfg = params.game;
    // 提示開啟時才需要預覽；預覽要把每個選項各自玩到穩定，約 1～2 秒：先顯示等待訊息，下一個 event loop 再算，畫面才不會卡住
    if (hintOn && (!previewCache || previewCache.round !== g.round)) {
      panel.appendChild(h('div', 'game-note', '計算預覽中…（把每個選項各自玩到穩定）'));
      const round = g.round;
      setTimeout(() => {
        if (state.game.phase !== 'choosing' || state.game.round !== round || !hintOn) return;
        previewCache = { round, data: previewOffers(state, params) };
        renderGamePanel();
      }, 30);
      return;
    }
    const pv = hintOn ? previewCache.data : null;
    panel.appendChild(h('div', 'game-note', `選一個選項，然後生態會一直跑到穩定（至少 ${2 * cfg.stableWindowTicks}、最多 ${cfg.maxWaitTicks} Tick）；任何時候有物種滅絕就立刻失敗。` + (hintOn ? '下方預覽 = 選了之後這一回合實際會發生的結果（測試用）；各物種的數字是和「什麼都不改」相比，回合結束時的數量變化。' : '提示已隱藏，只能憑對生態的理解判斷。')));
    const offers = h('div', 'offers');
    g.offers.forEach((offerId, i) => {
      const m = modOf(offerId);
      const card = h('div', 'offer');
      card.appendChild(h('h3', '', modifierLabel(m, strength)));
      card.appendChild(h('div', 'desc', m.desc));
      if (pv) {
        const opt = pv.options[i];
        card.appendChild(h('span', `badge ${opt.health.level}`, `預覽健康度 ${opt.health.score}`));
        card.appendChild(h('div', opt.ended === 'settled' ? 'game-note' : 'warn-text', endedText(opt)));
        if (opt.health.extinct.length) card.appendChild(h('div', 'warn-text', `⚠ 滅絕：${opt.health.extinct.map(labelOf).join('、')}`));
        // 各物種的變化：和「什麼都不改」比，這回合結束時的數量差多少（排除掉本來就會有的自然起伏）
        const chips = h('div', 'chips');
        for (const sp of state.species) {
          const baseFinal = pv.baseline.final[sp.id];
          const gone = opt.final[sp.id] === 0 && baseFinal > 0;
          const c = baseFinal > 0 ? opt.final[sp.id] / baseFinal - 1 : 0;
          chips.appendChild(h('span', `chip ${gone ? 'gone' : c < -0.3 ? 'down' : c > 0.3 ? 'up' : ''}`, gone ? `${sp.label} 滅絕` : `${sp.label} ${pctText(c)}`));
        }
        card.appendChild(chips);
      }
      const btn = h('button', '', '選這個');
      btn.addEventListener('click', () => {
        pickLog.push({ round: g.round, index: i, hint: hintOn });
        addMarker(history, { type: 'pick', tick: state.tick, label: `第 ${g.round} 回合：${modifierLabel(m, strength)}` });
        renderChartCaption();
        state = chooseOffer(state, i, params);
        if (!speedLocked) speed = 500; // 回合要等很久，沒手動指定過速度時，選定後自動切到最快；玩家調整過的速度不會被改掉
        render();
        renderGamePanel();
        schedule();
      });
      card.appendChild(btn);
      // 測試輔助：網址加 ?autopick=1 自動選第一個、?picks=… 依序自動選（用來跑完整局驗證流程、重現測試者的那一局）
      const want = PICKS ? PICKS[g.round - 1] : AUTOPICK ? 0 : undefined; // ?picks=1,0,2 依回合自動選；?autopick=1 一律選第 1 個
      if (want === i) setTimeout(() => btn.click(), 0);
      offers.appendChild(card);
    });
    panel.appendChild(offers);
    if (pv) panel.appendChild(h('div', 'game-note', `對照：什麼都不改的話，${endedText(pv.baseline).replace(/^[⚠⏱] /, '')}，健康度 ${pv.baseline.health.score}${pv.baseline.health.extinct.length ? `，滅絕：${pv.baseline.health.extinct.map(labelOf).join('、')}` : ''}。`));
    // 提示按鈕：切換顯示／隱藏預測結果（健康度、各物種數量變化、穩定時間、滅絕警告）
    const hint = h('button', `hint-btn${hintOn ? ' active' : ''}`, hintOn ? '💡 提示：顯示預測中（點擊隱藏）' : '💡 提示：預測已隱藏（點擊顯示）');
    hint.addEventListener('click', () => {
      hintOn = !hintOn;
      renderGamePanel();
    });
    panel.appendChild(hint);
  } else if (g.phase === 'running') {
    panel.appendChild(Object.assign(h('div', 'game-note', ''), { id: 'gameRemain' }));
    if (g.warmup) panel.appendChild(h('div', 'game-note', '這段時間可以自由觀察各物種的數量、年齡環與能量流動，記住它們的樣子：之後每個選項都會改變這個生態。想看快一點，可以用下方的速度按鈕。'));
    const track = h('div', 'progress');
    track.appendChild(Object.assign(h('i', ''), { id: 'gameProgress' }));
    panel.appendChild(track);
    updateGameStatus();
  } else {
    const r = g.result;
    const rounds = g.history.length;
    panel.appendChild(h('div', `result ${r.won ? 'won' : 'lost'}`, r.won
      ? `勝利！${g.totalRounds} 個回合結束，沒有任何物種滅絕。${r.settled ? '' : '（最後一回合等到上限仍未達穩定）'}`
      : `失敗：${rounds === 0 ? '觀察期' : `第 ${rounds} 回合`}中 ${r.extinct.map(labelOf).join('、')} 滅絕了。`));
    const again = h('button', '', '再玩一次');
    again.addEventListener('click', startGameMode);
    panel.appendChild(again);
  }
  if (g.warmupInfo) panel.appendChild(h('div', 'history', `觀察期：${g.warmupInfo.ticks} Tick ${g.warmupInfo.ended === 'settled' ? '後穩定' : g.warmupInfo.ended === 'timeout' ? '（等到上限仍未穩定）' : '時有物種滅絕'}`));
  if (g.history.length) {
    panel.appendChild(h('div', 'history', '已選擇：' + g.history.map((x) => {
      const how = x.ended === null ? '進行中' : x.ended === 'settled' ? `${x.ticks} Tick 後穩定` : x.ended === 'timeout' ? `${x.ticks} Tick 仍未穩定` : `${x.ticks} Tick 時滅絕`;
      return `第 ${x.round} 回合 ${modifierLabel(modOf(x.id), strength)}（${how}）`;
    }).join('； ')));
  }
  appendRecordBlock(panel);
}

// 倍速：低倍速每步 1 Tick、間隔縮短；高倍速固定每 STEP_MS 毫秒一步，一步內連續跑多個 Tick，只在步末重繪一次
const SPEEDS = [1, 2, 5, 10, 50, 100, 500];
const STEP_MS = 50;
const urlSpeed = Number(new URLSearchParams(location.search).get('speed'));
if (SPEEDS.includes(urlSpeed)) { speed = urlSpeed; speedLocked = true; }
const speedBtns = {};
for (const sp of SPEEDS) {
  const b = document.createElement('button');
  b.textContent = `${sp}x`;
  b.addEventListener('click', () => { speed = sp; speedLocked = true; render(); schedule(); });
  $('speedBtns').appendChild(b);
  speedBtns[sp] = b;
}

function schedule() {
  clearTimeout(timer);
  const perTickMs = params.tickMs / speed;
  timer = setTimeout(step, Math.max(perTickMs, STEP_MS));
}

function step() {
  if (!paused && state.status === 'playing') {
    const ticks = Math.max(1, Math.round((STEP_MS * speed) / params.tickMs));
    const n = params.tickMs / speed >= STEP_MS ? 1 : ticks;
    if (gameMode) {
      // 遊戲模式：只有執行階段才前進；回合結束進入選擇階段時停下並重建面板
      for (let i = 0; i < n && state.game.phase === 'running'; i++) {
        state = advanceGame(state, params);
        sampleHistory();
      }
      syncGameMarkers();
      render();
      if (`${state.game.phase}-${state.game.round}` !== panelKey) renderGamePanel();
    } else {
      for (let i = 0; i < n; i++) {
        state = tick(state, params);
        sampleHistory();
      }
      render();
    }
  }
  schedule();
}

$('pauseBtn').addEventListener('click', () => { paused = !paused; render(); });
$('restartBtn').addEventListener('click', () => {
  if (gameMode) { startGameMode(); return; }
  state = createInitialState(params, GAME_SEED);
  paused = false;
  resetHistory();
  render();
});
$('gameBtn').addEventListener('click', () => (gameMode ? exitGameMode() : startGameMode()));

setupChartControls();
resetHistory();
render();
schedule();
if (new URLSearchParams(location.search).get('mode') === 'game') startGameMode();
