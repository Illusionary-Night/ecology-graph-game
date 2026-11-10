// 數量變化圖的 Canvas 繪製。資料與座標換算在 history.js（純函式、有測試），這裡只負責畫。
import { computeReference, yFraction, decimate, niceTickStep, visibleWindow, nearestIndex, REL_MIN, REL_MAX, RAW_LOG_MAX } from './history.js?v=2bde8609';

// 每個物種一種顏色（互相要分得開；也和畫面上的圖例晶片一致）
export const SPECIES_COLORS = {
  grass: '#2e9e4f', bush: '#9bbf2a', mouse: '#8d6e63', rabbit: '#e91e8c', deer: '#ff9800', fox: '#d32f2f', wolf: '#3f51b5',
};

const M = { left: 50, right: 12, top: 16, bottom: 26 }; // 繪圖區邊界
const fmtCount = (n) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n));

// opts：{ mode: 'relative' | 'raw', range: 'all' | 數字, hidden: Set（不顯示的物種 id）, labels: { id: 名稱 }, hoverTick: number | null }
export function drawChart(canvas, h, opts) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(320, canvas.clientWidth || 640);
  const cssH = 260;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = '11px system-ui, "Noto Sans TC", sans-serif';

  const plotW = cssW - M.left - M.right;
  const plotH = cssH - M.top - M.bottom;
  const win = visibleWindow(h, opts.range);
  if (win.end - win.start < 1) {
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';
    ctx.fillText('資料累積中…（每 10 Tick 取樣一次）', cssW / 2, cssH / 2);
    return;
  }
  const span = Math.max(1, win.t1 - win.t0);
  const xOfTick = (t) => M.left + ((t - win.t0) / span) * plotW;
  const yOf = (value, ref) => M.top + (1 - yFraction(value, opts.mode, ref)) * plotH;
  const ref = computeReference(h);

  // 水平格線與縱軸文字
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const grid = opts.mode === 'relative'
    ? [REL_MIN, 0.1, 1, 10, REL_MAX].map((r) => ({ f: yFraction(r, 'relative', 1), text: r === 1 ? '×1 平常' : `×${r}`, strong: r === 1 }))
    : Array.from({ length: RAW_LOG_MAX + 1 }, (_, k) => ({ f: yFraction(10 ** k, 'raw'), text: fmtCount(10 ** k), strong: false }));
  for (const g of grid) {
    const y = M.top + (1 - g.f) * plotH;
    ctx.strokeStyle = g.strong ? '#999' : '#e4e4e4';
    ctx.lineWidth = g.strong ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(M.left, y);
    ctx.lineTo(M.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = g.strong ? '#444' : '#888';
    ctx.fillText(g.text, M.left - 6, y);
  }
  // 橫軸刻度（Tick）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const step = niceTickStep(span, 8);
  for (let t = Math.ceil(win.t0 / step) * step; t <= win.t1; t += step) {
    const x = xOfTick(t);
    ctx.strokeStyle = '#f0f0f0';
    ctx.beginPath();
    ctx.moveTo(x, M.top);
    ctx.lineTo(x, M.top + plotH);
    ctx.stroke();
    ctx.fillStyle = '#888';
    ctx.fillText(String(t), x, M.top + plotH + 6);
  }

  // 事件標記（垂直線）：觀察期結束、選擇（藍，附編號旗子）、回合結束、滅絕（紅）
  for (const m of h.markers) {
    if (m.tick < win.t0 || m.tick > win.t1) continue;
    const x = xOfTick(m.tick);
    ctx.save();
    ctx.lineWidth = m.type === 'pick' || m.type === 'extinct' ? 1.5 : 1;
    ctx.strokeStyle = m.type === 'pick' ? '#1976d2' : m.type === 'extinct' ? '#c62828' : '#aaa';
    ctx.setLineDash(m.type === 'warmup' ? [4, 3] : m.type === 'end' ? [1, 3] : []);
    ctx.beginPath();
    ctx.moveTo(x, M.top);
    ctx.lineTo(x, M.top + plotH);
    ctx.stroke();
    ctx.restore();
    if (m.type === 'pick') {
      ctx.fillStyle = '#1976d2';
      ctx.beginPath();
      ctx.arc(x, M.top + 1, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(m.n), x, M.top + 1.5);
    }
  }

  // 折線：每個物種把可見範圍的資料降取樣成至多「繪圖區寬度」個點
  const n = Math.max(2, Math.min(Math.floor(plotW), win.end - win.start + 1));
  const tickSlice = h.ticks.slice(win.start, win.end + 1);
  const tx = decimate(tickSlice, n);
  for (const id of h.ids) {
    if (opts.hidden.has(id)) continue;
    const values = decimate(h.series[id].slice(win.start, win.end + 1), n);
    ctx.strokeStyle = SPECIES_COLORS[id] ?? '#333';
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = xOfTick(tx[i]);
      const y = yOf(v, ref[id]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  // 滅絕：在該物種顏色的位置畫 ✕
  for (const m of h.markers) {
    if (m.type !== 'extinct' || m.tick < win.t0 || m.tick > win.t1) continue;
    const x = xOfTick(m.tick);
    const y = M.top + plotH - 5;
    ctx.strokeStyle = SPECIES_COLORS[m.speciesId] ?? '#c62828';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 5);
    ctx.lineTo(x + 5, y + 5);
    ctx.moveTo(x + 5, y - 5);
    ctx.lineTo(x - 5, y + 5);
    ctx.stroke();
  }
  // 繪圖區外框
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 1;
  ctx.strokeRect(M.left, M.top, plotW, plotH);

  // 滑鼠移上去：垂直參考線與數值方塊
  if (opts.hoverTick !== null && opts.hoverTick !== undefined) {
    const idx = nearestIndex(h.ticks, opts.hoverTick);
    if (idx >= win.start && idx <= win.end) {
      const x = xOfTick(h.ticks[idx]);
      ctx.strokeStyle = '#555';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, M.top);
      ctx.lineTo(x, M.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      const rows = h.ids.filter((id) => !opts.hidden.has(id)).map((id) => ({ id, v: h.series[id][idx], r: h.series[id][idx] / ref[id] }));
      const boxW = 150;
      const boxH = 18 + rows.length * 15;
      const bx = x + 10 + boxW > cssW - 4 ? x - 10 - boxW : x + 10;
      const by = M.top + 4;
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      ctx.strokeStyle = '#999';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeRect(bx, by, boxW, boxH);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#333';
      ctx.fillText(`Tick ${h.ticks[idx]}`, bx + 8, by + 10);
      rows.forEach((row, i) => {
        const y = by + 18 + i * 15 + 6;
        ctx.fillStyle = SPECIES_COLORS[row.id] ?? '#333';
        ctx.fillRect(bx + 8, y - 4, 8, 8);
        ctx.fillStyle = '#333';
        ctx.fillText(`${opts.labels[row.id] ?? row.id} ${Math.round(row.v).toLocaleString('en-US')}（×${row.r >= 10 ? row.r.toFixed(0) : row.r.toFixed(2)}）`, bx + 22, y);
      });
    }
  }
}
