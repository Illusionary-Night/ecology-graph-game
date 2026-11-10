// 單一 Tick 的更新（SPEC 第 4 節，順序不可改）與勝負判定（第 6 節）。
import { createRng, stochasticRound, sampleBinomial } from './rng.js?v=2bde8609';
import { edgeFlows, envIncome, getSpecies, hungerRatio, isStarving, seasonFactor } from './derived.js?v=2bde8609';
import { adultCount, addNewborns, basalNeed, hasSeedBank, isStaged, removeIndividuals } from './ages.js?v=2bde8609';
import { checkInvariants, DEFAULT_PARAMS } from './state.js?v=2bde8609';

// 物種若已完全滅絕，池中殘餘能量歸入帳本 deathLoss（不留在已滅絕的物種裡）。
// prototype：老死、餓死不帶走能量，能量留在共享能量池，所以族群縮小後倖存者平均能量會上升（負回饋）；
// 只有「被捕食」會讓獵物的能量離開能量池。
function settleIfExtinct(s, ledger) {
  if (s.count === 0 && s.seeds === 0 && s.energy > 0) { // 種子庫裡還有種子時不算滅絕，保留能量給之後發芽的植株
    ledger.deathLoss += s.energy;
    s.energy = 0;
  }
}

// 回傳新 state；遊戲已結束時原樣回傳
export function tick(state, params = DEFAULT_PARAMS) {
  if (state.status !== 'playing') return state;
  const next = structuredClone(state);
  const rng = createRng(next.rngState);
  const L = next.ledger;

  // 1. 環境輸入（生產者；乘上季節因子）
  const season = seasonFactor(next.tick, params);
  for (const s of next.species) {
    if (s.kind === 'producer') {
      const income = envIncome(s, season);
      s.energy += income;
      L.envInput += income;
    }
  }

  // 2. 基礎代謝（實際支出不得超過現有能量）
  for (const s of next.species) {
    const spent = Math.min(s.energy, basalNeed(s, params)); // 幼年代謝打折
    s.energy -= spent;
    L.metabolism += spent;
  }

  // 3. 捕食（依 edges 順序，逐條以當下狀態計算）
  // 各邊預期捕食量以捕食階段開始時的狀態計算（含主食／副食占比上限），再依序套用；k 另受當下獵物數量限制
  const flows = edgeFlows(next);
  for (let idx = 0; idx < next.edges.length; idx++) {
    const e = next.edges[idx];
    const prey = getSpecies(next, e.prey);
    const predator = getSpecies(next, e.predator);
    const k = Math.min(stochasticRound(flows[idx], rng), prey.count);
    if (k <= 0) continue;
    // prototype：被吃掉的能量 = k × 獵物「平均個體能量」（而非固定 unitEnergy），避免獵物能量低時被加速抽乾
    const removed = Math.min(k * (prey.energy / prey.count), prey.energy);
    const countBefore = prey.count;
    removeIndividuals(prey, k); // 被捕食按各年齡格比例分擔，除不盡的優先給最老（成年）的格
    prey.energy -= removed;
    if (prey.seeds > 0 && params.seedLeak > 0) {
      // 種子幾乎不會被吃：機率 = seedLeak × 該 Tick 植株被吃掉的比例
      prey.seeds -= sampleBinomial(prey.seeds, Math.min(1, (params.seedLeak * k) / countBefore), rng);
    }
    predator.energy += params.transferRate * removed;
    L.dissipated += (1 - params.transferRate) * removed;
  }

  // 3b. 老化（prototype，年齡結構）：每個個體每 Tick 以 1/ageBinTicks 的機率移到下一格，從最後一格被推出去就是老死。
  // 餵不飽（能量比值 < matureLine）時幼年那幾格不移動（不成長）。由老到幼處理，避免同一個體一個 Tick 內連跳兩格。
  // 在繁殖之前執行，所以本 Tick 剛出生的個體不會立刻移動。
  for (const s of next.species) {
    if (!isStaged(s) || s.count === 0) continue;
    const fed = hungerRatio(s) >= params.matureLine;
    const bins = s.ages.length;
    for (let a = bins - 1; a >= 0; a--) {
      if (a < s.matureBin && !fed) continue;
      const moved = sampleBinomial(s.ages[a], 1 / params.ageBinTicks, rng);
      if (moved === 0) continue;
      s.ages[a] -= moved;
      if (a === bins - 1) s.count -= moved; // 老死
      else s.ages[a + 1] += moved;
    }
    settleIfExtinct(s, L);
  }

  // 3c. 種子庫（prototype）：種子老化消失，其餘依 germination × 季節因子發芽成成年植株。
  // 在繁殖之前執行，所以本 Tick 剛產生的種子不會立刻發芽。
  for (const s of next.species) {
    if (!hasSeedBank(s) || s.seeds === 0) continue;
    s.seeds -= sampleBinomial(s.seeds, 1 / s.seedLifespan, rng);
    const sprouted = sampleBinomial(s.seeds, Math.min(1, Math.max(0, s.germination * season)), rng);
    s.seeds -= sprouted;
    s.count += sprouted;
    settleIfExtinct(s, L);
  }

  // 4. 繁殖（prototype：需有成年個體，且繁殖後保留 reserveRatio 的能量；有年齡階段的物種，新生的是幼年）
  for (const s of next.species) {
    if (adultCount(s) === 0) continue;
    const spare = s.energy - params.reserveRatio * s.unitEnergy * s.count;
    const births = Math.max(0, Math.min(Math.floor(spare / s.reproCost), s.reproCap));
    if (hasSeedBank(s)) s.seeds += births; // 植物繁殖產生的是種子
    else addNewborns(s, births);
    s.energy -= births * s.reproCost;
    L.reproduction += births * s.reproCost; // 繁殖花費的能量離開能量池（記入帳本）
  }

  // 5. 老死：每個個體 1/lifespan 機率死亡（以二項分布抽樣死亡數）。有年齡結構的物種已在 3b 處理，這裡跳過
  for (const s of next.species) {
    if (isStaged(s)) continue;
    removeIndividuals(s, sampleBinomial(s.count, 1 / s.lifespan, rng));
    settleIfExtinct(s, L);
  }

  // 6. 餓死
  for (const s of next.species) {
    if (!isStarving(s, params)) continue;
    const ratio = hungerRatio(s);
    let deaths = Math.min(s.count, Math.floor(s.count * params.starveRate * (1 - ratio / params.starveLine)));
    if (s.energy <= 0) deaths = Math.max(deaths, 1); // 能量耗盡時至少死 1 個（prototype 簡化 SPEC 第 6 步）
    removeIndividuals(s, deaths, 'youngestFirst'); // 餓死時最年輕的先死（餵不飽幼年的代價）
    settleIfExtinct(s, L);
  }

  next.tick += 1;
  if (next.tick % params.pointsPerTick === 0) next.points += 1;

  // 7. 勝負判定（上帝模式不判定）
  if (!params.godMode) {
    if (next.species.some((s) => s.introduced && s.count === 0 && s.seeds === 0)) next.status = 'lost';
    else if (next.tick >= params.winTicks) next.status = 'won';
  }

  next.rngState = rng.getState();
  checkInvariants(next, params);
  return next;
}
