// 年齡結構（prototype）：有 ages 陣列的物種，ages[a] 為「第 a 格年齡」的個體數，count 恆等於陣列總和。
// 每格代表 ageBinTicks 個 Tick；每 Tick 每個個體以 1/ageBinTicks 的機率移到下一格（見 tick.js），
// 最後一格再被推出去就是老死。前 matureBin 格是幼年，其餘是成年。
// 此檔不得 import 其他引擎模組（避免循環相依）；帶「（會修改）」的函式會直接改傳入的物種物件。

export function isStaged(s) {
  return Array.isArray(s.ages);
}

// 是否有種子庫（僅生產者，設有 seedLifespan）
export function hasSeedBank(s) {
  return s.seedLifespan !== undefined;
}

export function juvenileCount(s) {
  if (!isStaged(s)) return 0;
  let n = 0;
  for (let a = 0; a < s.matureBin && a < s.ages.length; a++) n += s.ages[a];
  return n;
}

export function adultCount(s) {
  return s.count - juvenileCount(s);
}

// 基礎代謝需求：成年全額、幼年打折（juvenileBasalRatio）
export function basalNeed(s, params) {
  return s.basal * (adultCount(s) + params.juvenileBasalRatio * juvenileCount(s));
}

// 把 total 個個體均勻分配到 bins 格，除不盡的給最老的格（穩定時各格人數大致相等）
export function makeAges(bins, total) {
  const ages = new Array(bins).fill(Math.floor(total / bins));
  let rest = total - ages.reduce((a, b) => a + b, 0);
  for (let a = bins - 1; rest > 0; a--, rest--) ages[a] += 1;
  return ages;
}

// （會修改）加入 n 個個體（玩家投放、上帝模式增加數量用）：按「當前各年齡格的人數比例」分配，
// 這樣不會憑空多出一堆餵不飽的幼體或老個體。餘數依小數部分由大到小補給各格；
// 物種目前沒有個體（沒有比例可依）時，改為各格均勻分配。無年齡結構的物種只增加 count。
export function addIndividuals(s, n) {
  if (n <= 0) return;
  if (!isStaged(s)) {
    s.count += n;
    return;
  }
  const bins = s.ages.length;
  const total = s.ages.reduce((a, b) => a + b, 0);
  const weights = total > 0 ? s.ages.map((x) => x / total) : new Array(bins).fill(1 / bins);
  const shares = weights.map((w) => w * n);
  const add = shares.map((x) => Math.floor(x));
  let rest = n - add.reduce((a, b) => a + b, 0);
  const order = shares.map((x, a) => ({ a, frac: x - Math.floor(x) })).sort((p, q) => q.frac - p.frac || q.a - p.a);
  for (let k = 0; rest > 0; k = (k + 1) % bins, rest--) add[order[k].a] += 1;
  for (let a = 0; a < bins; a++) s.ages[a] += add[a];
  s.count += n;
}

// （會修改）加入 n 個新生個體：放在第 0 格（幼年）
export function addNewborns(s, n) {
  if (n <= 0) return;
  s.count += n;
  if (isStaged(s)) s.ages[0] += n;
}

// （會修改）移除 d 個個體，回傳實際移除數。
// mode 'proportional'（預設）：按各格當前人數比例分擔，除不盡的優先從最老的格（成年）扣；
// mode 'youngestFirst'：從最年輕的格開始扣（餓死時幼年先死）。
export function removeIndividuals(s, d, mode = 'proportional') {
  const dd = Math.min(d, s.count);
  if (dd <= 0) return 0;
  if (!isStaged(s)) {
    s.count -= dd;
    return dd;
  }
  const ages = s.ages;
  let remaining = dd;
  if (mode === 'youngestFirst') {
    for (let a = 0; a < ages.length && remaining > 0; a++) {
      const take = Math.min(ages[a], remaining);
      ages[a] -= take;
      remaining -= take;
    }
  } else {
    const total = s.count;
    for (let a = 0; a < ages.length; a++) {
      const share = Math.floor((dd * ages[a]) / total);
      ages[a] -= share;
      remaining -= share;
    }
    for (let a = ages.length - 1; a >= 0 && remaining > 0; a--) {
      const take = Math.min(ages[a], remaining);
      ages[a] -= take;
      remaining -= take;
    }
  }
  s.count -= dd;
  return dd;
}
