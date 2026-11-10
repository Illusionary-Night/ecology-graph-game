// 數量變化圖的資料與座標換算（純函式，不碰 DOM，可用 node --test 測試）。
// 歷史資料放在「畫面層」，絕對不要放進引擎的 state：tick() 每次都會複製整個 state，歷史越長每個 tick 越慢
// （實測累積 3 萬 Tick 的歷史放進 state 會讓每個 tick 慢 6.5 倍）。

export const SAMPLE_EVERY = 10; // 每幾個 Tick 取樣一次
export const REL_MIN = 0.01; // 相對倍數座標的下限（×0.01）
export const REL_MAX = 100; // 上限（×100）
export const RAW_LOG_MAX = 7; // 原始數量座標的上限（10^7）

export function createHistory(ids) {
  return { ids: [...ids], ticks: [], series: Object.fromEntries(ids.map((id) => [id, []])), markers: [], refEndTick: null };
}

// 記錄一個取樣點。只在 tick 是 SAMPLE_EVERY 的倍數、且這個 tick 還沒記過時才記。counts：{ 物種id: 數量 }。回傳是否有記錄
export function recordSample(h, tick, counts) {
  if (tick % SAMPLE_EVERY !== 0) return false;
  if (h.ticks.length > 0 && h.ticks[h.ticks.length - 1] >= tick) return false;
  h.ticks.push(tick);
  for (const id of h.ids) h.series[id].push(counts[id] ?? 0);
  return true;
}

// 加一個事件標記：{ type: 'warmup' | 'pick' | 'end' | 'extinct', tick, label, speciesId? }。pick 會自動編號（1, 2, 3…）
export function addMarker(h, marker) {
  const m = { ...marker };
  if (m.type === 'pick') m.n = h.markers.filter((x) => x.type === 'pick').length + 1;
  h.markers.push(m);
  return m;
}

// 設定「平常」的參考值要用到哪個 tick 為止（觀察期結束時呼叫）；沒設定時用前 1120 Tick（約一個週期）
export function setReferenceEnd(h, tick) {
  h.refEndTick = tick;
}

// 各物種的參考值 = 參考期間內的平均數量；平均為 0 時用 1，避免除以 0。資料還沒有時回傳 1
export function computeReference(h) {
  const end = h.refEndTick ?? 1120;
  const ref = {};
  for (const id of h.ids) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < h.ticks.length && h.ticks[i] <= end; i++) {
      sum += h.series[id][i];
      n++;
    }
    if (n === 0 && h.ticks.length > 0) { sum = h.series[id][0]; n = 1; }
    const mean = n > 0 ? sum / n : 0;
    ref[id] = mean > 0 ? mean : 1;
  }
  return ref;
}

// 把數值換成縱軸位置（0 = 底、1 = 頂）。relative：對數座標 ×REL_MIN ～ ×REL_MAX，value / ref 超出範圍會被夾住（數量 0 貼在底部）；
// raw：對數座標 1 ～ 10^RAW_LOG_MAX
export function yFraction(value, mode, ref = 1) {
  if (mode === 'relative') {
    const r = Math.min(REL_MAX, Math.max(REL_MIN, value / ref));
    return (Math.log10(r) - Math.log10(REL_MIN)) / (Math.log10(REL_MAX) - Math.log10(REL_MIN));
  }
  return Math.min(1, Math.log10(Math.max(1, value)) / RAW_LOG_MAX);
}

// 降取樣：把 values 壓成至多 n 個點，每個點是對應區段的平均（點數本來就不多時原樣回傳）
export function decimate(values, n) {
  if (values.length <= n) return values.slice();
  const out = new Array(n);
  const step = values.length / n;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = a; j < b; j++) sum += values[j];
    out[i] = sum / (b - a);
  }
  return out;
}

// 「漂亮」的刻度間距：讓 span 切成不超過 maxTicks 段，間距是 1、2、5 × 10 的次方
export function niceTickStep(span, maxTicks) {
  const raw = Math.max(span, 1) / Math.max(maxTicks, 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}

// 可見範圍：range 為 'all'（全部）或數字（只看最近這麼多 Tick）。回傳 { start, end（含）, t0, t1 }；沒有資料時 start > end
export function visibleWindow(h, range) {
  const n = h.ticks.length;
  if (n === 0) return { start: 0, end: -1, t0: 0, t1: 0 };
  const last = h.ticks[n - 1];
  const from = range === 'all' ? 0 : Math.max(0, last - range);
  let start = 0;
  while (start < n && h.ticks[start] < from) start++;
  return { start, end: n - 1, t0: h.ticks[start], t1: last };
}

// 找出最接近 tick 的取樣索引（二分搜尋）；沒有資料回傳 -1
export function nearestIndex(ticks, tick) {
  if (ticks.length === 0) return -1;
  let lo = 0;
  let hi = ticks.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ticks[mid] < tick) lo = mid;
    else hi = mid;
  }
  return Math.abs(ticks[lo] - tick) <= Math.abs(ticks[hi] - tick) ? lo : hi;
}
