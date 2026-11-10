// 「複製這局紀錄」的文字產生器（純函式，不碰 DOM，可用 node --test 測試）。
// 測試者把這段文字貼回來，開發者就能用同一個種子與選擇順序（網址參數 seed、picks）完整重現那一局。
import { MODIFIERS, modifierLabel } from '../engine/game.js?v=a75d2c77';

const fmt = (n) => Number(n).toLocaleString('en-US');

// state：目前遊戲 state（含 state.game）；pickLog：[{ round, index, hint }]，玩家每回合選了第幾個選項、當時提示是否開啟；
// seed／build／url／strength／hintOn：種子、版本代號、目前網址（不含參數）、選項強度、目前提示是否開啟
export function buildRecord({ state, pickLog, seed, build, url, strength, hintOn }) {
  const g = state.game;
  const modLabel = (id) => (id ? modifierLabel(MODIFIERS.find((m) => m.id === id), strength) : '（無）');
  const lines = ['【生態圖論 prototype 遊戲紀錄】', `版本：${build}　種子：${seed}　選項強度：${strength}　目前提示：${hintOn ? '顯示' : '隱藏'}`];

  // 目前狀態
  let status;
  if (!g) status = '尚未開始三選一遊戲';
  else if (g.phase === 'finished') status = g.result.won ? `已結束：勝利（${g.totalRounds} 個回合沒有物種滅絕${g.result.settled ? '' : '，最後一回合未達穩定'}）` : `已結束：失敗（${g.result.extinct.map((id) => state.species.find((x) => x.id === id).label).join('、')} 滅絕）`;
  else if (g.warmup) status = '觀察期中';
  else if (g.phase === 'choosing') status = `第 ${g.round} / ${g.totalRounds} 回合：選擇中`;
  else status = `第 ${g.round} / ${g.totalRounds} 回合：等待生態穩定中`;
  lines.push(`狀態：${status}（Tick ${state.tick}）`);

  if (g) {
    if (g.warmupInfo) lines.push(`觀察期：${g.warmupInfo.ticks} Tick ${g.warmupInfo.ended === 'settled' ? '後穩定' : g.warmupInfo.ended === 'timeout' ? '仍未穩定（逾時）' : '時有物種滅絕'}`);
    g.history.forEach((h, i) => {
      const p = pickLog[i];
      const how = h.ended === null ? '進行中' : h.ended === 'settled' ? `${h.ticks} Tick 後穩定` : h.ended === 'timeout' ? `${h.ticks} Tick 仍未穩定（逾時）` : `${h.ticks} Tick 時有物種滅絕`;
      lines.push(`第 ${h.round} 回合：${modLabel(h.id)}${p ? `（第 ${p.index + 1} 個選項；選的時候提示${p.hint ? '開' : '關'}）` : ''} → ${how}`);
    });
  }

  lines.push(`各物種目前數量：${state.species.map((x) => `${x.label} ${fmt(x.count)}`).join('、')}`);
  const picks = pickLog.map((p) => p.index);
  lines.push(`重現這局：${url}?mode=game&seed=${seed}${picks.length ? `&picks=${picks.join(',')}` : ''}`);
  return lines.join('\n');
}
