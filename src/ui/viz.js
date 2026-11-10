// 畫面用的純函式（不碰 DOM，可用 node --test 測試）：箭頭的視覺參數、年齡環的分組與幾何。
// 只負責「把 state 的數字換成視覺參數」；真正畫圖在 main.js。

export const clamp01 = (x) => Math.max(0, Math.min(1, x));

// 把年齡陣列合併成至多 maxGroups 組（相鄰格合併）。每組：{ from, to, sum }（from、to 為格的索引，含）
export function groupBins(ages, maxGroups) {
  const n = ages.length;
  const size = Math.max(1, Math.ceil(n / maxGroups));
  const groups = [];
  for (let i = 0; i < n; i += size) {
    const to = Math.min(n, i + size);
    let sum = 0;
    for (let a = i; a < to; a++) sum += ages[a];
    groups.push({ from: i, to: to - 1, sum });
  }
  return groups;
}

// 年齡環每個小圓圈的資料：
//   share：該組人數占總數的比例；
//   brightness：該組人數 ÷ 人數最多那組（0..1，讓各組差異看得出來）；
//   juvenile：該組起點在幼年格內（前 matureBin 格）。
export function ageRingCells(ages, matureBin, maxGroups = 36) {
  const total = ages.reduce((a, b) => a + b, 0);
  const groups = groupBins(ages, maxGroups);
  const maxSum = groups.reduce((m, g) => Math.max(m, g.sum), 0);
  return groups.map((g) => ({
    ...g,
    share: total > 0 ? g.sum / total : 0,
    brightness: maxSum > 0 ? g.sum / maxSum : 0,
    juvenile: g.from < matureBin,
  }));
}

// n 個小圓圈沿半徑 ringRadius 的圓排列：從正上方（12 點鐘）開始順時針，年齡由小到大。
// 回傳相對圓心的座標與圓圈半徑（圓圈直徑約占弧長的 fill×2，且不超過 maxDotRadius）。
export function ringGeometry(n, ringRadius, maxDotRadius = 3.4, fill = 0.42) {
  const r = Math.min(maxDotRadius, ((2 * Math.PI * ringRadius) / n) * fill);
  const dots = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    dots.push({ x: ringRadius * Math.cos(angle), y: ringRadius * Math.sin(angle), r });
  }
  return dots;
}

// 食物鏈箭頭的視覺參數。
//   share：此邊占捕食者食物能量來源的比例（0..1）→ 決定顏色與發光強度；
//   relFlow：此邊的能量流量 ÷ 所有邊中最大的流量（0..1）→ 決定能量點移動的快慢。
// 回傳：color（CSS 顏色）、glowPx（發光半徑）、opacity、dashSeconds（能量點跑一個循環的秒數，null 表示不顯示）。
export function edgeVisual(share, relFlow) {
  const s = clamp01(share);
  const f = Math.sqrt(clamp01(relFlow)); // 開根號：流量很小的邊也看得到在動
  return {
    color: `hsl(${(44 - 14 * s).toFixed(1)} 95% ${(46 + 20 * s).toFixed(1)}%)`,
    glowPx: s === 0 ? 0 : 1 + 7 * s,
    opacity: s === 0 ? 0 : 0.35 + 0.65 * s,
    dashSeconds: f <= 0 || s === 0 ? null : 3.2 - 2.6 * f,
  };
}

// 百分比標籤的位置：沿著邊（端點 p = {x1,y1,x2,y2}）依序嘗試幾個位置，挑第一個不落在任何節點區域（rects，含外加 margin）內的；
// 都被擋住時退回中點。y 方向上移 6，避免壓在線上。
export function pickLabelPoint(p, rects, fractions = [0.5, 0.4, 0.6, 0.32, 0.68, 0.25, 0.75], margin = 8) {
  const at = (t) => ({ x: p.x1 + (p.x2 - p.x1) * t, y: p.y1 + (p.y2 - p.y1) * t - 6 });
  for (const t of fractions) {
    const pt = at(t);
    const blocked = rects.some((r) => pt.x > r.x0 - margin && pt.x < r.x1 + margin && pt.y > r.y0 - margin && pt.y < r.y1 + margin);
    if (!blocked) return pt;
  }
  return at(fractions[0]);
}
