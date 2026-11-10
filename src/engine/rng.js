// Seeded 亂數產生器（mulberry32）。引擎內所有隨機數都必須來自這裡，禁用 Math.random()。

// 以整數狀態建立 rng；getState() 取回目前狀態，讓 state 可完整重現
export function createRng(seedState) {
  let s = seedState >>> 0;
  return {
    // 回傳 [0, 1) 的浮點數
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    getState() {
      return s;
    },
  };
}

// 機率進位：期望值等於 x（例如 2.3 → 80% 得 2、30% 得 3 的機率）
export function stochasticRound(x, rng) {
  const base = Math.floor(x);
  return base + (rng.next() < x - base ? 1 : 0);
}

// 標準常態亂數（Box-Muller），使用 seeded rng
function normal(rng) {
  const u = 1 - rng.next(); // (0, 1]
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 二項分布 Binomial(n, p) 的抽樣：小族群逐個體抽籤（精確）；大族群用 Poisson / 常態近似，避免 O(n)
export function sampleBinomial(n, p, rng) {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (n <= 64) {
    let k = 0;
    for (let i = 0; i < n; i++) if (rng.next() < p) k++;
    return k;
  }
  const mean = n * p;
  if (mean < 30) {
    // Knuth 的 Poisson 抽樣
    const limit = Math.exp(-mean);
    let k = 0;
    let prod = rng.next();
    while (prod > limit) {
      k++;
      prod *= rng.next();
    }
    return Math.min(k, n);
  }
  const sd = Math.sqrt(mean * (1 - p));
  return Math.max(0, Math.min(n, Math.round(mean + sd * normal(rng))));
}
