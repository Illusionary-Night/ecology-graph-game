// 所有數值參數集中於此（SPEC 第 9 節）。標註「prototype」者為 SPEC 未定、暫時自訂的值，見 PROTOTYPE_NOTES.md。
// 數量級以 COUNT_SCALE 放大：下方「基準值」是 scale = 1 時的數字，buildConfig 依倍率換算成實際值。
// 個體層級的數值（unitEnergy、basal、lifespan、reproCost、每個體環境收入、maxIntake）不受倍率影響。

export const COUNT_SCALE = 1000; // prototype：數量放大倍率，降低隨機波動造成的滅絕

// 全域參數
export const GLOBAL_PARAMS = {
  transferRate: 0.1, // 十分之一定律
  starveLine: 0.3, // SPEC 暫定
  starveRate: 0.2, // SPEC 暫定
  winTicks: 180, // SPEC 暫定
  pointsPerTick: 10, // SPEC 暫定：每 10 Tick 加 1 點
  startPoints: 5, // SPEC
  tickMs: 1000, // 畫面每 1 秒 1 Tick
  invariantEpsilon: 1e-6, // 能量守恆的浮點誤差容忍
  // --- 以下為 prototype 自訂 ---
  reserveRatio: 0.6, // 繁殖後至少保留的能量比例（相對 idealEnergy）
  // 季節（prototype）：生產者的環境收入乘上季節因子 1 + A·sin(2π·tick/一年長度)，全年平均為 1。amplitude = 0 即關閉
  seasonLengthTicks: 160, // 一年的長度（Tick），= 32 個年齡格
  seasonAmplitude: 0.9, // 起伏幅度 A：旺季收入 ×(1+A)、淡季 ×(1−A)（0.6 → 0.9：淡季降幅更大，讓植物與草食動物的互動看得出來）
  // 種子庫（prototype）：有 seedLifespan 的生產者，繁殖產生的是種子（不計入個體數、不分攤能量池）。
  // 種子每 Tick 以 1/seedLifespan 機率消失，其餘以「germination × 季節因子」的機率發芽成成年植株；
  // 動物吃植物時種子也有小機率被吃到：機率 = seedLeak × 該 Tick 植株被吃掉的比例。
  seedLeak: 0.05,
  startSeedRatio: 0.5, // 初始種子數 = 植株數 × 此值
  startEnergyRatio: 0.6, // 初始狀態每個物種的能量比值（= reserveRatio，剛好在繁殖門檻上，避免一開局就爆量繁殖）
  spawnEnergyRatio: 1, // 投放／設定數量時，每個新個體帶入的能量 = unitEnergy × 此值
  defaultSeed: 12345,
  // 年齡結構（prototype，偏離 SPEC 第 0 節「MVP 不做」，使用者明確要求）：只對設有 maturationTicks 的物種生效（目前僅狐、狼）。
  // 這些物種以 ages 陣列記錄各年齡格的人數，每格 ageBinTicks 個 Tick，每 Tick 每個個體以 1/ageBinTicks 機率移到下一格。
  ageBinTicks: 5,
  juvenileBasalRatio: 0.7, // 幼年（前 matureBin 格）代謝 = 成年代謝 × 此值
  matureLine: 0.45, // 能量比值 ≥ 此值（餵得飽）幼年才會往下一格移動；否則不成長
  // 三選一遊戲（prototype）：共 rounds 個回合，每回合先從固定牌組抽 offersPerRound 個選項，選定後生態開始跑，
  // 一直等到「穩定」才進入下一回合：每 sampleEvery Tick 取樣，每 checkEveryTicks Tick 算一段平均，
  // 連續兩個視窗（各 stableWindowTicks Tick，約等於生態的一個週期）各物種平均值的相對變化都 ≤ stableTolerance 就算穩定。
  // 有物種滅絕立刻失敗；等待超過 maxWaitTicks 就強制結束這回合（標註未達穩定）。
  // strength 為選項強度的次方數（實際倍率 = 基準倍率 ** strength；3 時亂選約 33% 勝率、看預覽選最好約 75%）。
  game: { rounds: 6, offersPerRound: 3, strength: 3, sampleEvery: 10, checkEveryTicks: 280, stableWindowTicks: 1120, stableTolerance: 0.15, maxWaitTicks: 8000 },
  godMode: true, // 上帝模式：不花點數、可任意設定各物種數量、不做勝負判定（false 則回到 SPEC 第 6、7 節）
};

// 物種基準值（scale = 1）。reproCap、envCapacity 會乘以倍率。
// seedLifespan、germination（選用，僅生產者）：種子平均壽命（Tick）與每 Tick 的發芽率（乘上季節因子）。設定即啟用種子庫。
// maturationTicks（選用）：幼年平均多少 Tick 長成成年；設定即啟用年齡結構（目前動物都啟用）（幼年不狩獵、不繁殖、餓死時先死）。
// 啟用後 lifespan 解讀為「成年後的平均壽命」，總格數 = (maturationTicks + lifespan) / ageBinTicks，老死 = 從最後一格被推出去。
// envInput 為「每個體」每 Tick 的環境收入（prototype，偏離 SPEC），實際收入 = envInput × count × (1 − count / envCapacity)
const SPECIES_BASE = [
  { id: 'grass', kind: 'producer', label: '草', unitEnergy: 10, basal: 0.1, lifespan: 80, reproCost: 10, reproCap: 40, envInput: 0.6, envCapacity: 2000, seedLifespan: 400, germination: 0.02 },
  { id: 'bush', kind: 'producer', label: '灌木', unitEnergy: 20, basal: 0.1, lifespan: 150, reproCost: 20, reproCap: 15, envInput: 0.5, envCapacity: 800, seedLifespan: 400, germination: 0.02 },
  { id: 'mouse', kind: 'consumer', label: '鼠', unitEnergy: 4, basal: 0.057, lifespan: 60, reproCost: 2, reproCap: 8, envInput: 0, maturationTicks: 5 },
  { id: 'rabbit', kind: 'consumer', label: '兔', unitEnergy: 10, basal: 0.12, lifespan: 100, reproCost: 10, reproCap: 3, envInput: 0, maturationTicks: 12 },
  { id: 'deer', kind: 'consumer', label: '鹿', unitEnergy: 40, basal: 0.2805, lifespan: 250, reproCost: 40, reproCap: 1, envInput: 0, maturationTicks: 20 },
  { id: 'fox', kind: 'consumer', label: '狐', unitEnergy: 4.5, basal: 0.03726, lifespan: 417, reproCost: 2.895, reproCap: 4, envInput: 0, maturationTicks: 35 },
  { id: 'wolf', kind: 'consumer', label: '狼', unitEnergy: 10, basal: 0.02865, lifespan: 396, reproCost: 8.56, reproCap: 4, envInput: 0, maturationTicks: 35 },
];

// 捕食邊基準值（scale = 1）：predator 吃 prey。
// efficiency 會除以倍率；maxIntake 為「每隻捕食者每 Tick 最多吃幾隻」（prototype，總上限 = maxIntake × 捕食者數）；
// refuge（選用，基準值×倍率 = 個體數）：獵物避難所，保護因子 = 獵物數/(獵物數+refuge)，稀少獵物幾乎不會被捕食但不為零；
// maxShare（選用，0..1）為這條邊的食物能量最多占該捕食者總攝食能量的比例（主食／副食，副食上限，prototype）。
// 例：雜食的狐吃灌木只當副食 →  { predator: 'fox', prey: 'bush', efficiency: 0.0001, maxIntake: 0.02, maxShare: 0.25 }（預設未啟用，加入後需重新驗證存活率）
const EDGES_BASE = [
  { predator: 'rabbit', prey: 'grass', efficiency: 0.000531, maxIntake: 0.799 },
  { predator: 'rabbit', prey: 'bush', efficiency: 0.000114, maxIntake: 0.115 },
  { predator: 'mouse', prey: 'bush', efficiency: 0.000872, maxIntake: 25.0 }, // 鼠只吃灌木種子（與吃草的兔、鹿資源分化，避免競爭排除）
  { predator: 'deer', prey: 'grass', efficiency: 0.000999, maxIntake: 528 },
  { predator: 'deer', prey: 'bush', efficiency: 0.000306, maxIntake: 0.316 },
  { predator: 'fox', prey: 'rabbit', efficiency: 0.0146, maxIntake: 0.146, refuge: 1.0 },
  { predator: 'fox', prey: 'mouse', efficiency: 0.0133, maxIntake: 0.0983, refuge: 0.5 },
  { predator: 'fox', prey: 'bush', efficiency: 0.0001, maxIntake: 0.02, maxShare: 0.25 }, // 雜食：灌木漿果只能當副食，最多占狐總攝食能量的 25%
  { predator: 'wolf', prey: 'deer', efficiency: 0.0105, maxIntake: 0.0675, refuge: 0.8 },
  { predator: 'wolf', prey: 'rabbit', efficiency: 0.00443, maxIntake: 0.37, refuge: 1.0 },
  { predator: 'wolf', prey: 'fox', efficiency: 0.00191, maxIntake: 0.00626, refuge: 0.03 },
];

// 初始數量基準值（scale = 1）。一般模式只有草；上帝模式預設放一個大致平衡的生態。
const START_COUNTS_BASE = { grass: 50 };
const START_COUNTS_GOD_BASE = { grass: 1014, bush: 113, mouse: 6.0, rabbit: 4.8, deer: 2.3, fox: 0.74, wolf: 0.73 }; // 接近平衡的起點（fox/wolf 實際為 740、730 隻）

// 一般模式的投放：花費點數與一次投放的基準個體數
const SPAWN_BASE = {
  grass: { cost: 1, amount: 5 },
  bush: { cost: 2, amount: 3 },
  mouse: { cost: 2, amount: 5 },
  rabbit: { cost: 3, amount: 5 },
  deer: { cost: 5, amount: 2 },
  fox: { cost: 5, amount: 1 },
  wolf: { cost: 6, amount: 1 },
};

const scaleMap = (m, k) => Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v * k]));

// 依倍率建立完整設定：{ params, speciesDefs, edgeDefs }。每次呼叫都回傳全新物件。
export function buildConfig(scale = COUNT_SCALE) {
  const params = {
    ...GLOBAL_PARAMS,
    scale,
    godMaxCount: 2000 * scale, // 上帝模式單一物種數量上限
    godStep: scale, // 上帝模式 ± 按鈕的基本步長
    startCounts: scaleMap(START_COUNTS_BASE, scale),
    startCountsGod: scaleMap(START_COUNTS_GOD_BASE, scale),
    spawn: Object.fromEntries(Object.entries(SPAWN_BASE).map(([id, v]) => [id, { cost: v.cost, amount: v.amount * scale }])),
  };
  const speciesDefs = SPECIES_BASE.map((d) => ({
    ...d,
    reproCap: d.reproCap * scale,
    ...(d.envCapacity !== undefined ? { envCapacity: d.envCapacity * scale } : {}),
    ...(d.maturationTicks !== undefined
      ? {
          matureBin: Math.max(1, Math.round(d.maturationTicks / params.ageBinTicks)),
          ageBins: Math.max(2, Math.round((d.maturationTicks + d.lifespan) / params.ageBinTicks)),
        }
      : {}),
  }));
  const edgeDefs = EDGES_BASE.map((e) => ({
    ...e,
    efficiency: e.efficiency / scale,
    ...(e.refuge !== undefined ? { refuge: e.refuge * scale } : {}), // 避難所大小以個體數計，隨倍率放大
  }));
  return { params, speciesDefs, edgeDefs };
}
