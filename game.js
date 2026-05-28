// == 尺棋 (Ruler Chess) — 游戏核心逻辑 v8 ====================================

const BOARD_SIZE = 16;
const START = { row: 15, col: 0 };
const END = { row: 0, col: 15 };
const BIG_MARKS = new Set([0, 5, 10, 15, 20]);
const RULER_MAX = 20;
const DICE_MIN = 1;
const DICE_MAX = 6;

const FLAG_COUNT = 5;
const WIN_FLAG_COUNT = 3;
const BLOCK_SIZE = 3;

const ITEM_TYPES = {
  smallBomb:  { label: '小炸弹', symbol: '💣', count: 8, color: '#e67e22' },
  bigBomb:    { label: '大炸弹', symbol: '💥', count: 2, color: '#c0392b' },
  ladder:     { label: '梯子',   symbol: '🪜', count: 2, color: '#27ae60' },
  potion:     { label: '药水',   symbol: '🧪', count: 4, color: '#8e44ad' },
};

// -- State ------------------------------------------------------------------

const state = {
  players: [
    { name: '白皇后', ruler: 0, pos: { row: START.row, col: START.col }, cssClass: 'piece-white' },
    { name: '红皇后', ruler: 0, pos: { row: START.row, col: START.col }, cssClass: 'piece-red'  },
  ],
  currentPlayer: 0,
  diceValue: 0,
  phase: 'roll',            // 'roll' | 'move' | 'zone-select' | 'gameover'
  remainingSteps: 0,
  items: [],
  flags: { red: [], white: [] },
  collectedFlags: [0, 0],
  enemyFlagPicked: [false, false],
  blockedZones: [null, null],
  zoneSelect: null,
  potionActive: [false, false],
  log: [],
  gameOver: false,
  winner: null,
  _remote: false,           // true when processing opponent's action
  _forceDice: null,         // forced dice value for remote roll
};

// -- Helpers ----------------------------------------------------------------

function clonePos(p) { return { row: p.row, col: p.col }; }
function posEq(a, b) { return a.row === b.row && a.col === b.col; }
function inBounds(r, c) { return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE; }
function manhattan(a, b) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col); }
function isStart(r, c) { return r === START.row && c === START.col; }
function isEnd(r, c)    { return r === END.row   && c === END.col;   }
function currentPlayer() { return state.players[state.currentPlayer]; }

function log(msg) {
  state.log.unshift({ text: msg, turn: state.currentPlayer, time: Date.now() });
  if (state.log.length > 50) state.log.length = 50;
}

// -- Placement --------------------------------------------------------------

function placeItems() {
  state.items = [];
  const occupied = buildOccupied();
  for (const [typeKey, def] of Object.entries(ITEM_TYPES)) {
    for (let i = 0; i < def.count; i++) {
      placeRandom(occupied, (row, col) => state.items.push({ type: typeKey, row, col }));
    }
  }
}

function placeFlags() {
  state.flags = { red: [], white: [] };
  const occupied = buildOccupied();
  for (const it of state.items) occupied.add(`${it.row},${it.col}`);

  for (const color of ['red', 'white']) {
    for (let i = 0; i < FLAG_COUNT; i++) {
      placeRandom(occupied, (row, col) => {
        state.flags[color].push({ row, col });
        // Mark 3×3 exclusion zone so flags don't cluster
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const er = row + dr, ec = col + dc;
            if (inBounds(er, ec)) occupied.add(`${er},${ec}`);
          }
        }
      });
    }
  }
}

function buildOccupied() {
  const occ = new Set();
  occ.add(`${START.row},${START.col}`);
  occ.add(`${END.row},${END.col}`);
  return occ;
}

function placeRandom(occupied, cb) {
  let row, col, key;
  let attempts = 0;
  do {
    row = randInt(0, BOARD_SIZE - 1);
    col = randInt(0, BOARD_SIZE - 1);
    key = `${row},${col}`;
    attempts++;
  } while (occupied.has(key) && attempts < 1000);
  if (attempts >= 1000) return;
  occupied.add(key);
  cb(row, col);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getItemAt(r, c) {
  return state.items.find(it => it.row === r && it.col === c) || null;
}

function removeItemAt(r, c) {
  const idx = state.items.findIndex(it => it.row === r && it.col === c);
  if (idx !== -1) state.items.splice(idx, 1);
}

// -- Flags ------------------------------------------------------------------

function getFlagAt(r, c) {
  for (const color of ['red', 'white']) {
    const idx = state.flags[color].findIndex(f => f.row === r && f.col === c);
    if (idx !== -1) return { color, index: idx, row: r, col: c };
  }
  return null;
}

function removeFlagAt(r, c) {
  for (const color of ['red', 'white']) {
    const idx = state.flags[color].findIndex(f => f.row === r && f.col === c);
    if (idx !== -1) { state.flags[color].splice(idx, 1); return color; }
  }
  return null;
}

function isOwnFlag(playerIndex, flagColor) {
  return (playerIndex === 0 && flagColor === 'white') || (playerIndex === 1 && flagColor === 'red');
}

// -- Blocked Zones ----------------------------------------------------------

function isInBlockedZone(r, c, playerIndex) {
  const zone = state.blockedZones[playerIndex];
  if (!zone) return false;
  return Math.abs(r - zone.r) <= 1 && Math.abs(c - zone.c) <= 1;
}

function canPlaceZone(centerRow, centerCol, blockedPlayerIndex) {
  if (!inBounds(centerRow, centerCol)) return false;
  const bp = state.players[blockedPlayerIndex].pos;
  return manhattan({ row: centerRow, col: centerCol }, bp) > 2;
}

// -- Ruler Logic ------------------------------------------------------------

function applyRulerBounce(currentRuler, diceValue) {
  let pos = currentRuler;
  let remaining = diceValue;
  let dir = (pos === RULER_MAX) ? -1 : 1;
  while (remaining > 0) {
    pos += dir;
    remaining--;
    if (pos === 0 || pos === RULER_MAX) dir = -dir;
  }
  return pos;
}

function isBigMark(pos) { return BIG_MARKS.has(pos); }

function nearestBigMark(pos) {
  const marks = [0, 5, 10, 15, 20];
  let best = marks[0];
  let bestDist = Math.abs(pos - marks[0]);
  for (const m of marks) {
    const d = Math.abs(pos - m);
    if (d < bestDist || (d === bestDist && m > best)) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

// -- Board Movement ---------------------------------------------------------

function getNeighbors(r, c, playerIndex) {
  if (playerIndex === undefined) playerIndex = state.currentPlayer;
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const result = [];
  for (const [dr, dc] of dirs) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && !isInBlockedZone(nr, nc, playerIndex)) {
      result.push({ row: nr, col: nc });
    }
  }
  return result;
}

function moveTowardTarget(fromRow, fromCol, targetRow, targetCol) {
  const neighbors = getNeighbors(fromRow, fromCol, state.currentPlayer);
  if (neighbors.length === 0) return null;
  const towardStart = targetRow === START.row && targetCol === START.col;
  neighbors.sort((a, b) => {
    const da = manhattan(a, { row: targetRow, col: targetCol });
    const db = manhattan(b, { row: targetRow, col: targetCol });
    if (da !== db) return da - db;
    if (towardStart) {
      return (b.row * 1000 + (BOARD_SIZE - b.col)) - (a.row * 1000 + (BOARD_SIZE - a.col));
    } else {
      return (b.row * 1000 + b.col) - (a.row * 1000 + a.col);
    }
  });
  return neighbors[0];
}

// -- Game Flow --------------------------------------------------------------

function startNewGame() {
  state.players[0].ruler = 0;
  state.players[0].pos = clonePos(START);
  state.players[1].ruler = 0;
  state.players[1].pos = clonePos(START);
  state.currentPlayer = 0;
  state.diceValue = 0;
  state.phase = 'roll';
  state.remainingSteps = 0;
  state.gameOver = false;
  state.winner = null;
  state.collectedFlags = [0, 0];
  state.enemyFlagPicked = [false, false];
  state.blockedZones = [null, null];
  state.zoneSelect = null;
  state.potionActive = [false, false];
  state.log = [];
  placeItems();
  placeFlags();
  log('新游戏开始！白皇后先手。经过旗子即可收集，收集 3 面己方旗后到达终点获胜。');
  render();
}

function rollDice() {
  if (state.phase !== 'roll' || state.gameOver) return;

  const dice = state._forceDice || randInt(DICE_MIN, DICE_MAX);
  state._forceDice = null;
  state.diceValue = dice;
  const player = currentPlayer();
  const oldRuler = player.ruler;

  const newRuler = applyRulerBounce(oldRuler, dice);
  player.ruler = newRuler;

  const bounceDesc = describeRulerPath(oldRuler, dice, newRuler);
  log(`${player.name} 投出 ${dice} 点，刻度尺: ${oldRuler} → ${newRuler}${bounceDesc}`);

  const hit = isBigMark(newRuler);
  if (hit) {
    const pi = state.currentPlayer;
    const multiplier = state.potionActive[pi] ? 2 : 1;
    if (state.potionActive[pi]) {
      log(`${player.name} 药水生效！移动步数加倍：${dice} × 2 = ${dice * 2} 步。`);
      state.potionActive[pi] = false;
    }
    state.remainingSteps = dice * multiplier;
    state.phase = 'move';
    log(`${player.name} 停在大格 ${newRuler}，获得 ${state.remainingSteps} 步移动机会！请点击相邻格子移动。`);
  } else {
    log(`${player.name} 未停在大格，无法移动，回合结束。`);
    switchTurn();
  }

  // Multiplayer: send roll to opponent
  if (MP.connected && !state._remote) {
    MP.send({ type: 'roll', dice, ruler: newRuler, hit, steps: state.remainingSteps, pi: state.currentPlayer, oldRuler });
  }

  render();
}

function describeRulerPath(from, dice, to) {
  let pos = from, remaining = dice, dir = (pos === RULER_MAX) ? -1 : 1;
  let hitTop = false, hitBottom = false;
  while (remaining > 0) {
    pos += dir;
    if (pos === RULER_MAX) hitTop = true;
    if (pos === 0) hitBottom = true;
    remaining--;
    if (pos === 0 || pos === RULER_MAX) dir = -dir;
  }
  const parts = [];
  if (hitTop) parts.push('触顶反弹');
  if (hitBottom) parts.push('触底反弹');
  return parts.length ? ` (${parts.join('，')})` : '';
}

function tryMoveTo(row, col) {
  if (state.phase !== 'move' || state.gameOver) return false;

  const player = currentPlayer();
  const pi = state.currentPlayer;
  const neighbors = getNeighbors(player.pos.row, player.pos.col, pi);
  if (!neighbors.some(n => n.row === row && n.col === col)) return false;

  // Execute the step
  player.pos.row = row;
  player.pos.col = col;
  state.remainingSteps--;
  log(`${player.name} 移动到 (${row}, ${col})，剩余 ${state.remainingSteps} 步。`);

  // Check flag at new position (pass through = collect)
  const flag = getFlagAt(row, col);
  let flagInfo = null;
  if (flag) {
    flagInfo = { color: flag.color, row: flag.row, col: flag.col };
    handleFlagPickup(pi, flag);
    if (state.phase === 'zone-select') {
      if (MP.connected && !state._remote) MP.send({ type: 'move', row, col, rSteps: state.remainingSteps, phase: state.phase, flag: flagInfo });
      render(); return true;
    }
  }

  // Check item at new position (pass through = trigger)
  const item = getItemAt(row, col);
  if (item) {
    if (MP.connected && !state._remote) MP.send({ type: 'move', row, col, rSteps: state.remainingSteps, phase: state.phase, item: { type: item.type, row: item.row, col: item.col }, flag: flagInfo });
    applyItem(item);
  }

  // Check end
  if (posEq(player.pos, END)) {
    if (state.collectedFlags[pi] >= WIN_FLAG_COUNT) {
      state.gameOver = true;
      state.winner = player;
      state.phase = 'gameover';
      log(`${player.name} 收集了足够旗子并到达终点，获胜！`);
    } else {
      log(`${player.name} 到达终点但旗子不足（${state.collectedFlags[pi]}/${WIN_FLAG_COUNT}），无法获胜。`);
      if (state.remainingSteps === 0) switchTurn();
    }
    if (MP.connected && !state._remote) MP.send({ type: 'move', row, col, rSteps: state.remainingSteps, phase: state.phase, flag: flagInfo, end: true });
    render();
    return true;
  }

  // If steps exhausted, end turn
  if (state.remainingSteps === 0) switchTurn();

  if (MP.connected && !state._remote && !item) {
    MP.send({ type: 'move', row, col, rSteps: state.remainingSteps, phase: state.phase, flag: flagInfo });
  }

  render();
  return true;
}

function applyItem(item) {
  const player = currentPlayer();
  const def = ITEM_TYPES[item.type];
  const itemRow = item.row, itemCol = item.col;
  log(`${player.name} 经过 ${def.label}！`);
  showItemEffect(item.type, itemRow, itemCol);

  switch (item.type) {
    case 'smallBomb':
      applyForcedMovement(START.row, START.col, 3);
      log(`${player.name} 被小炸弹炸退 3 格！`);
      break;
    case 'bigBomb':
      player.pos = clonePos(START);
      log(`${player.name} 被大炸弹炸回起点！`);
      break;
    case 'ladder':
      applyForcedMovement(END.row, END.col, 3);
      log(`${player.name} 通过梯子前进 3 格！`);
      break;
    case 'potion':
      state.potionActive[state.currentPlayer] = true;
      log(`${player.name} 获得药水！下次移动步数将加倍。`);
      break;
  }

  removeItemAt(itemRow, itemCol);
}

function applyForcedMovement(targetRow, targetCol, steps) {
  const player = currentPlayer();
  for (let i = 0; i < steps; i++) {
    const next = moveTowardTarget(player.pos.row, player.pos.col, targetRow, targetCol);
    if (!next) break;
    player.pos.row = next.row;
    player.pos.col = next.col;
  }
}

function handleFlagPickup(playerIndex, flag) {
  const player = state.players[playerIndex];
  if (isOwnFlag(playerIndex, flag.color)) {
    state.collectedFlags[playerIndex]++;
    removeFlagAt(flag.row, flag.col);
    log(`${player.name} 收集了己方${flag.color === 'red' ? '红旗' : '白旗'}！（${state.collectedFlags[playerIndex]}/${WIN_FLAG_COUNT}）`);
  } else {
    // Enemy flag
    if (state.enemyFlagPicked[playerIndex]) {
      log(`${player.name} 经过敌方旗子，但已使用过封锁能力，无效果。`);
      return;
    }
    state.enemyFlagPicked[playerIndex] = true;
    removeFlagAt(flag.row, flag.col);
    const blockedPlayer = 1 - playerIndex;
    log(`${player.name} 拔掉了敌方旗子！请点击棋盘选择 3×3 封锁区中心（不能靠近 ${state.players[blockedPlayer].name} 当前位置）。`);
    state.phase = 'zone-select';
    state.zoneSelect = { picker: playerIndex, blockedPlayer: blockedPlayer };
  }
}

function completeZoneSelection(centerRow, centerCol) {
  if (!state.zoneSelect) return;
  const { blockedPlayer, picker } = state.zoneSelect;
  if (!canPlaceZone(centerRow, centerCol, blockedPlayer)) {
    log('无效位置！封锁区中心不能靠近被封锁者（距离需 > 2）。请重新选择。');
    render();
    return;
  }
  state.blockedZones[blockedPlayer] = { r: centerRow, c: centerCol };
  log(`${state.players[picker].name} 设置了以 (${centerRow},${centerCol}) 为中心的 3×3 封锁区！${state.players[blockedPlayer].name} 无法通行。`);
  state.zoneSelect = null;
  if (MP.connected && !state._remote) MP.send({ type: 'zone', r: centerRow, c: centerCol, blockedPlayer });
  switchTurn();
  render();
}

function switchTurn() {
  state.currentPlayer = 1 - state.currentPlayer;
  state.diceValue = 0;
  state.phase = 'roll';
  state.remainingSteps = 0;
  state.zoneSelect = null;
  log(`--- 轮到 ${currentPlayer().name} ---`);
  if (MP.connected && !state._remote) MP.send({ type: 'turn', next: state.currentPlayer });
}

// -- Item Effects -----------------------------------------------------------

function showItemEffect(itemType, row, col) {
  const def = ITEM_TYPES[itemType];
  const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  if (cell) {
    cell.classList.add(`item-flash-${itemType}`);
    setTimeout(() => cell.classList.remove(`item-flash-${itemType}`), 700);
  }
  if (itemType === 'smallBomb' || itemType === 'bigBomb') {
    const board = document.getElementById('board');
    board.classList.add(itemType === 'bigBomb' ? 'board-shake-big' : 'board-shake');
    setTimeout(() => board.classList.remove('board-shake', 'board-shake-big'), 500);
  }
  const toast = document.createElement('div');
  toast.className = 'item-toast';
  toast.innerHTML = `<span class="toast-icon">${def.symbol}</span><span class="toast-text">踩到${def.label}！</span>`;
  document.getElementById('app').appendChild(toast);
  setTimeout(() => toast.remove(), 1600);
}

// -- Render -----------------------------------------------------------------

function render() {
  renderBoard();
  renderRulers();
  renderDice();
  renderTurnInfo();
  renderMoveInfo();
  renderLog();
  renderVictory();
}

function renderBoard() {
  const boardEl = document.getElementById('board');

  // Blocked zone cells
  let zoneCells = new Set();
  for (let pi = 0; pi < 2; pi++) {
    const z = state.blockedZones[pi];
    if (z) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const zr = z.r + dr, zc = z.c + dc;
          if (inBounds(zr, zc)) zoneCells.add(`${zr},${zc}`);
        }
      }
    }
  }

  // Valid moves
  let validMoves = new Set();
  if (state.phase === 'move' && !state.gameOver) {
    const cp = currentPlayer();
    for (const n of getNeighbors(cp.pos.row, cp.pos.col, state.currentPlayer)) {
      validMoves.add(`${n.row},${n.col}`);
    }
  }

  // Zone selection candidates
  let zoneSelectPreview = new Set();
  if (state.phase === 'zone-select' && state.zoneSelect) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (canPlaceZone(r, c, state.zoneSelect.blockedPlayer)) {
          zoneSelectPreview.add(`${r},${c}`);
        }
      }
    }
  }

  // Piece positions
  const pieces = new Map();
  for (let pi = 0; pi < state.players.length; pi++) {
    const p = state.players[pi];
    const key = `${p.pos.row},${p.pos.col}`;
    if (!pieces.has(key)) pieces.set(key, []);
    pieces.get(key).push(p.cssClass);
  }

  let html = '';
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      let cls = 'cell';
      if (isStart(r, c)) cls += ' cell-start';
      if (isEnd(r, c)) cls += ' cell-end';
      if (validMoves.has(`${r},${c}`)) cls += ' cell-movable';
      if (zoneSelectPreview.has(`${r},${c}`)) cls += ' cell-zone-select';

      html += `<div class="${cls}" data-row="${r}" data-col="${c}">`;
      html += `<span class="cell-coord">${r},${c}</span>`;
      if (isStart(r, c)) html += '<span class="cell-label">起点</span>';
      if (isEnd(r, c)) html += '<span class="cell-label">终点</span>';

      // Flags (visible)
      for (const color of ['red', 'white']) {
        for (const f of state.flags[color]) {
          if (f.row === r && f.col === c) {
            html += `<span class="flag-icon flag-${color}">${color === 'red' ? '🚩' : '🏳'}</span>`;
          }
        }
      }

      // Blocked zone overlay
      if (zoneCells.has(`${r},${c}`)) {
        html += '<span class="zone-overlay"></span>';
      }

      // Pieces
      const cellPieces = pieces.get(`${r},${c}`) || [];
      for (const css of cellPieces) {
        html += `<span class="piece ${css}">♛</span>`;
      }

      html += '</div>';
    }
  }

  boardEl.innerHTML = html;
}

function renderRulers() {
  for (let pi = 0; pi < 2; pi++) {
    const player = state.players[pi];
    const barEl = document.getElementById(`ruler-bar-p${pi}`);
    const valueEl = document.getElementById(`ruler-value-p${pi}`);
    const rulerEl = document.getElementById(`ruler-p${pi}`);
    barEl.style.width = `${(player.ruler / RULER_MAX) * 100}%`;
    valueEl.textContent = player.ruler;
    rulerEl.classList.toggle('active', pi === state.currentPlayer && !state.gameOver);
  }
}

function renderDice() {
  const diceEl = document.getElementById('dice-display');
  const rollBtn = document.getElementById('roll-btn');
  if (state.diceValue > 0) {
    diceEl.textContent = getDiceFace(state.diceValue);
    diceEl.classList.add('rolled');
  } else {
    diceEl.textContent = '🎲';
    diceEl.classList.remove('rolled');
  }
  rollBtn.disabled = (state.phase !== 'roll' || state.gameOver);
}

function getDiceFace(n) {
  return ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][n] || '🎲';
}

function renderTurnInfo() {
  const turnEl = document.getElementById('turn-indicator');
  if (state.gameOver) {
    turnEl.textContent = `🏆 ${state.winner.name} 获胜！`;
    turnEl.className = 'turn-banner winner';
  } else if (state.phase === 'zone-select') {
    const p = currentPlayer();
    turnEl.textContent = `${p.name} — 请选择 3×3 封锁区中心`;
    turnEl.className = `turn-banner ${p.cssClass.replace('piece-', 'turn-')}`;
  } else {
    const p = currentPlayer();
    turnEl.textContent = `当前回合：${p.name}`;
    turnEl.className = `turn-banner ${p.cssClass.replace('piece-', 'turn-')}`;
    if (state.phase === 'move') turnEl.textContent += ' — 可移动！';
  }
}

function renderMoveInfo() {
  const moveEl = document.getElementById('move-info');
  const w = state.collectedFlags[0], r = state.collectedFlags[1];
  const wz = state.blockedZones[0] ? ' 🚫' : '';
  const rz = state.blockedZones[1] ? ' 🚫' : '';
  const pw = state.potionActive[0] ? ' 🧪' : '';
  const pr = state.potionActive[1] ? ' 🧪' : '';
  moveEl.innerHTML = `🏳 白旗 ${w}/${WIN_FLAG_COUNT}${wz}${pw} &nbsp;|&nbsp; 🚩 红旗 ${r}/${WIN_FLAG_COUNT}${rz}${pr}`;
  if (state.phase === 'move') {
    moveEl.innerHTML += ` &nbsp;|&nbsp; 剩余步数：${state.remainingSteps}`;
  }
  moveEl.style.display = 'block';
}

function renderLog() {
  const logEl = document.getElementById('log-list');
  logEl.innerHTML = '';
  for (const entry of state.log.slice(0, 20)) {
    const li = document.createElement('li');
    li.textContent = entry.text;
    logEl.appendChild(li);
  }
}

function renderVictory() {
  const overlay = document.getElementById('victory-overlay');
  const msg = document.getElementById('victory-message');
  if (state.gameOver) {
    msg.textContent = `${state.winner.name} 到达终点，获得胜利！`;
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

// -- Ruler Ticks ------------------------------------------------------------

function initRulerTicks() {
  for (let pi = 0; pi < 2; pi++) {
    const track = document.getElementById(`ruler-ticks-p${pi}`);
    track.innerHTML = '';
    for (let mark = 0; mark <= RULER_MAX; mark++) {
      const tick = document.createElement('div');
      tick.className = 'ruler-tick' + (mark % 5 === 0 ? ' big' : '');
      tick.style.left = `${(mark / RULER_MAX) * 100}%`;
      track.appendChild(tick);
    }
  }
}

// -- Init -------------------------------------------------------------------

// -- Multiplayer Receiver ---------------------------------------------------

MP.onAction = function(action) {
  state._remote = true;
  switch (action.type) {
    case 'roll':
      state._forceDice = action.dice;
      state.players[action.pi].ruler = action.oldRuler;
      rollDice();
      break;
    case 'move':
      // Sync opponent's position
      state.players[action.pi].pos.row = action.row; // will be overwritten by tryMoveTo
      tryMoveTo(action.row, action.col);
      // If action included item/flag info, they were handled by tryMoveTo
      break;
    case 'zone':
      state.zoneSelect = { picker: 1 - action.blockedPlayer, blockedPlayer: action.blockedPlayer };
      completeZoneSelection(action.r, action.c);
      break;
    case 'turn':
      state.currentPlayer = action.next;
      state.phase = 'roll';
      state.diceValue = 0;
      state.remainingSteps = 0;
      log(`--- 轮到 ${currentPlayer().name} ---`);
      break;
  }
  state._remote = false;
  render();
};

MP.onReady = function() {
  startNewGame();
};

MP.onDisconnect = function() {
  log('对手已断开，游戏暂停。可刷新页面重新开始。');
  render();
};

MP.onStatus = function(msg) {
  const el = document.getElementById('mp-status');
  if (el) el.innerHTML = msg;
};

// -- Init -------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initRulerTicks();
  buildMpUI();

  document.getElementById('board').addEventListener('click', (e) => {
    if (!MP.isMyTurn()) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);

    if (state.phase === 'zone-select' && state.zoneSelect) {
      completeZoneSelection(row, col);
      return;
    }
    if (state.phase === 'move' && !state.gameOver) {
      tryMoveTo(row, col);
    }
  });
  document.getElementById('roll-btn').addEventListener('click', () => {
    if (!MP.isMyTurn()) return;
    rollDice();
  });
  document.getElementById('restart-btn').addEventListener('click', () => {
    if (MP.connected && !confirm('重新开始将断开联机，确定吗？')) return;
    MP.disconnect();
    startNewGame();
  });
  document.getElementById('new-game-btn').addEventListener('click', () => {
    if (MP.connected && !confirm('重新开始将断开联机，确定吗？')) return;
    MP.disconnect();
    startNewGame();
  });

  // If already joining via URL, don't auto-start
  if (!MP.connected && !(new URL(location.href)).searchParams.get('join')) {
    startNewGame(); // local game by default
  }
});

function buildMpUI() {
  const sidebar = document.getElementById('sidebar');
  const div = document.createElement('div');
  div.id = 'mp-panel';
  div.style.cssText = 'background:#16213e;border-radius:6px;padding:10px;';
  div.innerHTML = `
    <h3 style="font-size:0.85rem;color:#f0c040;margin:0 0 6px;">🌐 联机对战</h3>
    <div id="mp-status" style="font-size:0.8rem;color:#aaa;margin-bottom:8px;">未连接 — 可本地双人对战</div>
    <div id="mp-buttons" style="display:flex;gap:6px;flex-wrap:wrap;">
      <button id="mp-create" class="btn btn-primary" style="font-size:0.8rem;padding:6px 12px;">创建房间</button>
      <button id="mp-join-btn" class="btn btn-secondary" style="font-size:0.8rem;padding:6px 12px;">加入房间</button>
      <input id="mp-join-id" placeholder="输入房间号" style="display:none;flex:1;min-width:120px;padding:4px 6px;font-size:0.8rem;border:1px solid #4a4a6a;background:#0d0d1a;color:#e0e0e0;border-radius:4px;">
      <button id="mp-join-go" style="display:none;font-size:0.8rem;padding:6px 10px;background:#27ae60;color:#fff;border:none;border-radius:4px;cursor:pointer;">连接</button>
      <button id="mp-leave" class="btn btn-secondary" style="display:none;font-size:0.8rem;padding:6px 12px;">断开</button>
    </div>
  `;
  sidebar.insertBefore(div, sidebar.firstChild);

  document.getElementById('mp-create').addEventListener('click', () => {
    MP.createRoom();
    document.getElementById('mp-create').style.display = 'none';
    document.getElementById('mp-join-btn').style.display = 'none';
    document.getElementById('mp-leave').style.display = 'inline-block';
  });
  document.getElementById('mp-join-btn').addEventListener('click', () => {
    document.getElementById('mp-join-id').style.display = 'inline-block';
    document.getElementById('mp-join-go').style.display = 'inline-block';
    document.getElementById('mp-join-btn').style.display = 'none';
  });
  document.getElementById('mp-join-go').addEventListener('click', () => {
    const id = document.getElementById('mp-join-id').value.trim();
    if (id) MP.joinWithId(id);
    document.getElementById('mp-create').style.display = 'none';
    document.getElementById('mp-join-btn').style.display = 'none';
    document.getElementById('mp-join-id').style.display = 'none';
    document.getElementById('mp-join-go').style.display = 'none';
    document.getElementById('mp-leave').style.display = 'inline-block';
  });
  document.getElementById('mp-leave').addEventListener('click', () => {
    MP.disconnect();
    location.reload();
  });
}
