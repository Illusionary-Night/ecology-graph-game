// 生態健康度（prototype）：把一段時間內各物種的數量時間序列，濃縮成「有沒有滅絕」與「穩不穩定」的分數。
// 純函式，不碰 state；三選一遊戲的預覽與結果判定都用它。

// series：{ 物種id: 數量的時間序列 }；finalAlive：{ 物種id: 結束時是否存活（數量 > 0 或還有種子）}
// 回傳：
//   extinct：結束時已滅絕的物種；
//   stability：各物種「最低點 ÷ 平均」（0～1，越接近 1 越穩定；滅絕者為 0）；
//   score：0～100 的健康度 = 100 × 存活比例 × (0.4 + 0.6 × 平均穩定度)；
//   level：'bad'（有物種滅絕）、'warn'（沒滅絕但分數 < 60）、'good'。
export function ecoHealth(series, finalAlive) {
  const ids = Object.keys(series);
  const extinct = ids.filter((id) => !finalAlive[id]);
  const stability = {};
  for (const id of ids) {
    const xs = series[id];
    const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    stability[id] = finalAlive[id] && mean > 0 ? Math.min(1, Math.min(...xs) / mean) : 0;
  }
  const meanStability = ids.reduce((a, id) => a + stability[id], 0) / Math.max(1, ids.length);
  const aliveFraction = (ids.length - extinct.length) / Math.max(1, ids.length);
  const score = Math.round(100 * aliveFraction * (0.4 + 0.6 * meanStability));
  const level = extinct.length > 0 ? 'bad' : score >= 60 ? 'good' : 'warn';
  return { extinct, stability, meanStability, aliveFraction, score, level };
}

// 穩定度偵測（prototype）：buckets 是依時間排列的陣列，每個元素 { 物種id: 該段時間的平均數量 }，每段長度 = checkEveryTicks；
// 一個視窗 = windowBuckets 段。比較「最近一個視窗」與「前一個視窗」各物種的平均值，相對變化都 ≤ tolerance 才算穩定。
// 為什麼要取視窗平均：這個生態本來就有週期起伏（約 1100 Tick），視窗要約等於一個週期，平均值才不會跟著週期跑。
// 資料不足兩個視窗時 ready = false。兩個視窗都是 0 的物種略過（滅絕另外判定）；前一個視窗為 0、後一個不為 0 視為變化無限大。
export function stabilityCheck(buckets, windowBuckets, tolerance) {
  const n = buckets.length;
  if (n < 2 * windowBuckets || n === 0) return { ready: false, stable: false, maxChange: null, worstId: null };
  const ids = Object.keys(buckets[0]);
  const mean = (from) => Object.fromEntries(ids.map((id) => {
    let sum = 0;
    for (let k = from; k < from + windowBuckets; k++) sum += buckets[k][id];
    return [id, sum / windowBuckets];
  }));
  const prev = mean(n - 2 * windowBuckets);
  const cur = mean(n - windowBuckets);
  let maxChange = 0;
  let worstId = null;
  for (const id of ids) {
    if (prev[id] === 0 && cur[id] === 0) continue;
    const change = prev[id] === 0 ? Infinity : Math.abs(cur[id] / prev[id] - 1);
    if (change > maxChange) { maxChange = change; worstId = id; }
  }
  return { ready: true, stable: maxChange <= tolerance, maxChange, worstId };
}
