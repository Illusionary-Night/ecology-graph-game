// 建立初始狀態、玩家投放操作、不變量檢查。純函式：回傳新 state，不修改傳入物件。
import { buildConfig } from './params.js?v=a75d2c77';
import { addIndividuals, hasSeedBank, makeAges, removeIndividuals } from './ages.js?v=a75d2c77';

// 預設設定（依 COUNT_SCALE 建構）。params 即引擎各函式的 params 參數。
const DEFAULT_CONFIG = buildConfig();
export const DEFAULT_PARAMS = DEFAULT_CONFIG.params;
export const DEFAULT_SPECIES_DEFS = DEFAULT_CONFIG.speciesDefs;
export const DEFAULT_EDGE_DEFS = DEFAULT_CONFIG.edgeDefs;

export function createInitialState(params = DEFAULT_PARAMS, seed = params.defaultSeed, speciesDefs = DEFAULT_SPECIES_DEFS, edgeDefs = DEFAULT_EDGE_DEFS) {
  const species = speciesDefs.map((d) => ({
    ...d,
    count: 0,
    seeds: 0, // 種子庫（只有設 seedLifespan 的生產者使用）
    energy: 0,
    introduced: false, // 是否已被玩家投放過（失敗判定用）
  }));
  const start = params.godMode ? params.startCountsGod : params.startCounts;
  for (const s of species) {
    s.count = start[s.id] ?? 0;
    if (s.ageBins) s.ages = makeAges(s.ageBins, s.count); // 有年齡結構的物種：各格均勻分配
    s.seeds = hasSeedBank(s) ? Math.round(s.count * params.startSeedRatio) : 0;
    s.energy = s.count * s.unitEnergy * params.startEnergyRatio;
    s.introduced = s.count > 0;
  }
  const initialEnergy = species.reduce((sum, s) => sum + s.energy, 0);
  return {
    tick: 0,
    points: params.startPoints,
    status: 'playing', // 'playing' | 'won' | 'lost'
    seed,
    rngState: seed >>> 0,
    species,
    edges: edgeDefs.map((e) => ({ ...e })),
    // 能量帳本：用於能量守恆檢查
    ledger: { initialEnergy, injected: 0, envInput: 0, metabolism: 0, dissipated: 0, deathLoss: 0, reproduction: 0 },
  };
}

// 新個體帶入的單位能量：物種已有個體時 = 目前平均每隻的能量（不憑空給滿能量，避免人為的繁殖爆發）；
// 物種目前沒有個體時 = unitEnergy × spawnEnergyRatio。
function newcomerEnergy(s, params) {
  return s.count > 0 ? s.energy / s.count : s.unitEnergy * params.spawnEnergyRatio;
}

// 玩家投放物種。點數不足或遊戲已結束則回傳原 state。
export function spawn(state, speciesId, params = DEFAULT_PARAMS) {
  const def = params.spawn[speciesId];
  if (!def || state.status !== 'playing' || state.points < def.cost) return state;
  const next = structuredClone(state);
  const s = next.species.find((x) => x.id === speciesId);
  if (!s) return state;
  const addedEnergy = def.amount * newcomerEnergy(s, params);
  next.points -= def.cost;
  addIndividuals(s, def.amount);
  s.energy += addedEnergy;
  s.introduced = true;
  next.ledger.injected += addedEnergy;
  return next;
}

// 上帝模式：直接把物種數量設為 n（夾在 0..godMaxCount）。
// 增加個體時帶入 unitEnergy × 增加數 × spawnEnergyRatio 的能量（記入 injected）；
// 減少個體時按比例移除能量池（記入 deathLoss），能量守恆仍成立。
export function setCount(state, speciesId, n, params = DEFAULT_PARAMS) {
  const idx = state.species.findIndex((x) => x.id === speciesId);
  if (idx < 0) return state;
  const target = Math.max(0, Math.min(params.godMaxCount, Math.floor(Number.isFinite(n) ? n : 0)));
  if (target === state.species[idx].count) return state;
  const next = structuredClone(state);
  const s = next.species[idx];
  if (target > s.count) {
    const added = (target - s.count) * newcomerEnergy(s, params);
    s.energy += added;
    next.ledger.injected += added;
    s.introduced = true;
    addIndividuals(s, target - s.count); // 按當前各年齡格比例分配新增個體
  } else {
    const loss = s.energy * ((s.count - target) / s.count);
    s.energy -= loss;
    next.ledger.deathLoss += loss;
    removeIndividuals(s, s.count - target); // 減少的個體按各年齡格比例分擔
  }
  return next;
}

// 不變量檢查（SPEC 第 5 節），違反即拋錯
export function checkInvariants(state, params = DEFAULT_PARAMS) {
  for (const s of state.species) {
    if (!Number.isInteger(s.count) || s.count < 0) throw new Error(`Invariant: ${s.id}.count 不是非負整數 (${s.count})`);
    if (s.ages && (s.ages.some((n) => !Number.isInteger(n) || n < 0) || s.ages.reduce((x, y) => x + y, 0) !== s.count)) throw new Error(`Invariant: ${s.id}.ages 與 count 不一致 (${s.ages.join(',')} / ${s.count})`);
    if (!Number.isInteger(s.seeds) || s.seeds < 0) throw new Error(`Invariant: ${s.id}.seeds 不是非負整數 (${s.seeds})`);
    if (!Number.isFinite(s.energy) || s.energy < 0) throw new Error(`Invariant: ${s.id}.energy 無效 (${s.energy})`);
  }
  const L = state.ledger;
  const stock = state.species.reduce((sum, s) => sum + s.energy, 0);
  const out = L.dissipated + L.metabolism + L.deathLoss + L.reproduction;
  const inn = L.initialEnergy + L.injected + L.envInput;
  if (Math.abs(stock + out - inn) > params.invariantEpsilon * Math.max(1, inn)) {
    throw new Error(`Invariant: 能量不守恆 (存量+支出=${stock + out}, 輸入=${inn})`);
  }
}
