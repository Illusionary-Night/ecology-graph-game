// 推導量（SPEC 第 3 節）：由 state 計算，不存入狀態。皆為純函式。
import { adultCount, basalNeed } from './ages.js?v=2bde8609';

export function getSpecies(state, id) {
  return state.species.find((s) => s.id === id);
}

export function totalPopulation(state) {
  return state.species.reduce((sum, s) => sum + s.count, 0);
}

// 每 Tick 預期被捕食的數量（浮點，tick 內會再做機率進位）
// - 預設（SPEC 原公式）：efficiency × 獵物數 × 捕食者數，不超過獵物數。
// - prototype：邊可有 refuge（獵物避難所，見下）；
// - prototype：邊可有 maxIntake（每隻捕食者每 Tick 最多吃幾隻），總上限 = maxIntake × 捕食者數。
// - prototype（Holling II 型）：邊若設 halfSat，則改為 maxIntake × 捕食者數 × 獵物數 / (獵物數 + halfSat)，
//   獵物少時吃得少（保留稀少獵物的保護）、獵物多時趨近上限。此時 efficiency 不使用。
export function flow(edge, state) {
  const prey = getSpecies(state, edge.prey);
  const predator = getSpecies(state, edge.predator);
  const hunters = adultCount(predator); // 只有成年狩獵（幼年不狩獵）
  if (edge.halfSat !== undefined) {
    const intake = (edge.maxIntake * hunters * prey.count) / (prey.count + edge.halfSat);
    return Math.min(intake, prey.count);
  }
  const cap = (edge.maxIntake ?? Infinity) * hunters;
  // prototype：獵物避難所。edge.refuge（個體數）越大，稀少獵物越不易被找到；
  // 保護因子 = 獵物數 / (獵物數 + refuge)：獵物多時 ≈ 1，獵物極少時 ≈ 0（捕食量約隨獵物數的平方下降），但永遠 > 0，仍有被捕食的機會。
  const protect = edge.refuge ? prey.count / (prey.count + edge.refuge) : 1;
  return Math.min(edge.efficiency * prey.count * hunters * protect, prey.count, cap);
}

// prototype：套用「主食／副食占比上限」後，各邊（依 state.edges 順序）的預期捕食量。
// 邊若設 maxShare（0..1），代表該邊的食物能量最多占該捕食者總攝食能量的比例；
// 超過時削減到剛好等於上限（limit = m / (1 − m) × 其他來源的能量）。
// 若該捕食者沒有其他食物來源，副食的上限為 0（不能只靠副食活）。未設定 maxShare 的邊不受影響。
export function edgeFlows(state) {
  const raw = state.edges.map((e) => flow(e, state));
  const energy = state.edges.map((e, i) => {
    const prey = getSpecies(state, e.prey);
    return prey.count === 0 ? 0 : (raw[i] * prey.energy) / prey.count;
  });
  const groups = new Map();
  state.edges.forEach((e, i) => {
    if (!groups.has(e.predator)) groups.set(e.predator, []);
    groups.get(e.predator).push(i);
  });
  const flows = raw.slice();
  for (const idxs of groups.values()) {
    const capped = (i) => state.edges[i].maxShare !== undefined && state.edges[i].maxShare < 1;
    if (!idxs.some(capped)) continue;
    for (let pass = 0; pass < 2 * idxs.length + 2; pass++) {
      const total = idxs.reduce((sum, i) => sum + energy[i], 0);
      let changed = false;
      for (const i of idxs) {
        if (!capped(i)) continue;
        const m = state.edges[i].maxShare;
        const limit = (m / (1 - m)) * (total - energy[i]);
        if (energy[i] > limit + 1e-12) {
          flows[i] *= energy[i] > 0 ? limit / energy[i] : 0;
          energy[i] = limit;
          changed = true;
          break; // 總量變了，重新計算
        }
      }
      if (!changed) break;
    }
  }
  return flows;
}

export function idealEnergy(s) {
  return s.unitEnergy * s.count;
}

// count 為 0 時不適用，回傳 null
export function hungerRatio(s) {
  return s.count === 0 ? null : s.energy / idealEnergy(s);
}

export function isStarving(s, params) {
  const r = hungerRatio(s);
  return r !== null && r < params.starveLine;
}

// prototype：生產者每 Tick 的環境輸入 = 每個體收入 × 數量 × 承載量因子（越接近 envCapacity 越少，超過則為 0）
export function envIncome(s, season = 1) {
  if (s.kind !== 'producer' || s.count === 0) return 0;
  const room = Math.max(0, 1 - s.count / s.envCapacity);
  return s.envInput * s.count * room * season;
}

// prototype：季節因子（正弦波，全年平均 1）。第 0 Tick 為 1，之後先進入旺季。生產者的環境收入乘上它。
export function seasonFactor(tick, params) {
  if (!params.seasonAmplitude || !params.seasonLengthTicks) return 1;
  return 1 + params.seasonAmplitude * Math.sin((2 * Math.PI * tick) / params.seasonLengthTicks);
}

// prototype：某條邊佔「捕食者食物能量來源」的比例（0..1），用於決定箭頭粗細。
// 以預期被吃掉的能量（flow × 獵物平均個體能量）計算；捕食者所有邊的比例加總為 1（全無捕食時皆為 0）。
export function foodShare(edge, state) {
  const flows = edgeFlows(state);
  const energyOf = (i) => {
    const prey = getSpecies(state, state.edges[i].prey);
    return prey.count === 0 ? 0 : flows[i] * (prey.energy / prey.count);
  };
  const same = (e) => e.predator === edge.predator && e.prey === edge.prey;
  const idx = state.edges.findIndex(same);
  const mine = energyOf(idx);
  let total = 0;
  state.edges.forEach((e, i) => { if (e.predator === edge.predator) total += energyOf(i); });
  return total > 0 ? mine / total : 0;
}

// prototype：各邊（依 state.edges 順序）每 Tick 預期被捕食的「能量」＝ 有效預期捕食量 × 獵物平均個體能量。
// 畫面用它決定能量流動的快慢；獵物為 0 時為 0。
export function edgeEnergyFlows(state) {
  const flows = edgeFlows(state);
  return state.edges.map((e, i) => {
    const prey = getSpecies(state, e.prey);
    return prey.count === 0 ? 0 : (flows[i] * prey.energy) / prey.count;
  });
}

// prototype：自給率 = 預期每 Tick 能量收入 ÷ 代謝需求（basal × count）。
// 生產者的收入是環境輸入；消費者的收入是捕食所得（transferRate × 預期被吃的能量）。
// < 1 代表入不敷出（還不計繁殖與被捕食的支出），能量池會持續下降。count 為 0 時回傳 null。
export function selfSufficiency(s, state, params) {
  if (s.count === 0) return null;
  let income = envIncome(s, seasonFactor(state.tick, params));
  const flows = edgeFlows(state);
  state.edges.forEach((e, i) => {
    if (e.predator !== s.id) return;
    const prey = getSpecies(state, e.prey);
    if (prey.count > 0) income += params.transferRate * flows[i] * (prey.energy / prey.count);
  });
  const need = basalNeed(s, params);
  return need > 0 ? income / need : null;
}
