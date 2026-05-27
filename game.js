// == 尺棋 (Ruler Chess) — 游戏核心逻辑 ========================================

const BOARD_SIZE = 16;
const START = { row: 15, col: 0 };
const END = { row: 0, col: 15 };
const BIG_MARKS = new Set([0, 5, 10, 15, 20]);
const RULER_MAX = 20;
const DICE_MIN = 1;
const DICE_MAX = 6;

const ITEM_TYPES = {
  smallBomb:  { label: '小炸弹', symbol: '💣', count: 4, color: '#e67e22' },
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
  currentPlayer: 0,         // 0 = white (AI), 1 = red (human)
  diceValue: 0,
  phase: 'roll',            // 'roll' | 'move' | 'ai-thinking' | 'gameover'
  remainingSteps: 0,
  items: [],                // { type: 'smallBomb'|..., row, col }
  log: [],
  gameOver: false,
  winner: null,
  aiPlayer: 0,              // White is AI
  aiActive: false,          // true while AI is taking actions
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
  if (state.log.length > 50) state.log.length = 50; // keep bounded
}

// -- Item Placement ---------------------------------------------------------

function placeItems() {
  state.items = [];
  const occupied = new Set();
  occupied.add(`${START.row},${START.col}`);
  occupied.add(`${END.row},${END.col}`);

  for (const [typeKey, def] of Object.entries(ITEM_TYPES)) {
    for (let i = 0; i < def.count; i++) {
      let row, col, key;
      let attempts = 0;
      do {
        row = randInt(0, BOARD_SIZE - 1);
        col = randInt(0, BOARD_SIZE - 1);
        key = `${row},${col}`;
        attempts++;
      } while (occupied.has(key) && attempts < 1000);
      if (attempts >= 1000) continue; // safety valve
      occupied.add(key);
      state.items.push({ type: typeKey, row, col });
    }
  }
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

// -- Ruler Logic ------------------------------------------------------------

/** Apply dice to ruler with boundary-bounce. Returns final ruler position. */
function applyRulerBounce(currentRuler, diceValue) {
  let pos = currentRuler;
  let remaining = diceValue;
  // Always start moving toward 20 unless already at the top boundary
  let dir = (pos === RULER_MAX) ? -1 : 1;

  while (remaining > 0) {
    pos += dir;
    remaining--;
    if (pos === 0 || pos === RULER_MAX) {
      dir = -dir; // bounce
    }
  }
  return pos;
}

function isBigMark(pos) {
  return BIG_MARKS.has(pos);
}

function nearestBigMark(pos) {
  const marks = [0, 5, 10, 15, 20];
  let best = marks[0];
  let bestDist = Math.abs(pos - marks[0]);
  for (const m of marks) {
    const d = Math.abs(pos - m);
    // Tie-break: prefer the higher mark
    if (d < bestDist || (d === bestDist && m > best)) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

// -- Board Movement ---------------------------------------------------------

/** Return array of valid adjacent cells (neighbors on the board). */
function getNeighbors(r, c) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // up, down, left, right
  const result = [];
  for (const [dr, dc] of dirs) {
    const nr = r + dr;
    const nc = c + dc;
    if (inBounds(nr, nc)) result.push({ row: nr, col: nc });
  }
  return result;
}

/**
 * Move toward a target by picking the neighbor that minimizes manhattan distance.
 * Tie-break priority depends on target.
 *
 * Toward START (15,0): prefer moving down (row+1) then left (col-1)
 * Toward END   (0,15): prefer moving up   (row-1) then right (col+1)
 */
function moveTowardTarget(fromRow, fromCol, targetRow, targetCol) {
  const neighbors = getNeighbors(fromRow, fromCol);
  if (neighbors.length === 0) return null;

  // Sort: primary by manhattan to target, secondary by preferred direction
  const towardStart = targetRow === START.row && targetCol === START.col;

  neighbors.sort((a, b) => {
    const da = manhattan(a, { row: targetRow, col: targetCol });
    const db = manhattan(b, { row: targetRow, col: targetCol });
    if (da !== db) return da - db;

    if (towardStart) {
      // Prefer down (higher row), then left (lower col)
      const scoreA = a.row * 1000 + (BOARD_SIZE - a.col);
      const scoreB = b.row * 1000 + (BOARD_SIZE - b.col);
      return scoreB - scoreA;
    } else {
      // Prefer up (lower row), then right (higher col)
      const scoreA = (BOARD_SIZE - a.row) * 1000 + a.col;
      const scoreB = (BOARD_SIZE - b.row) * 1000 + b.col;
      return scoreB - scoreA;
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
  state.aiActive = false;
  state.log = [];
  placeItems();
  log('新游戏开始！白皇后 (AI) 先手。');

  if (state.currentPlayer === state.aiPlayer) {
    state.phase = 'ai-thinking';
    render();
    setTimeout(() => aiDoTurn(), 150);
  } else {
    render();
  }
}

function rollDice() {
  if (state.phase !== 'roll' || state.gameOver) return;

  const dice = randInt(DICE_MIN, DICE_MAX);
  state.diceValue = dice;
  const player = currentPlayer();
  const oldRuler = player.ruler;

  const newRuler = applyRulerBounce(oldRuler, dice);
  player.ruler = newRuler;

  // Build ruler path description for log
  const bounceDesc = describeRulerPath(oldRuler, dice, newRuler);
  log(`${player.name} 投出 ${dice} 点，刻度尺: ${oldRuler} → ${newRuler}${bounceDesc}`);

  if (isBigMark(newRuler)) {
    state.remainingSteps = dice;
    state.phase = 'move';
    log(`${player.name} 停在大格 ${newRuler}，获得 ${dice} 步移动机会！请点击相邻格子移动。`);
  } else {
    log(`${player.name} 未停在大格，无法移动，回合结束。`);
    switchTurn();
  }
  render();
}

function describeRulerPath(from, dice, to) {
  let pos = from;
  let remaining = dice;
  let dir = (pos === RULER_MAX) ? -1 : 1;
  const path = [pos];

  while (remaining > 0) {
    pos += dir;
    remaining--;
    path.push(pos);
    if (pos === 0 || pos === RULER_MAX) dir = -dir;
  }

  // Check if bounce occurred
  let hitTop = false, hitBottom = false;
  pos = from;
  dir = (pos === RULER_MAX) ? -1 : 1;
  remaining = dice;
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
  const neighbors = getNeighbors(player.pos.row, player.pos.col);
  const isValid = neighbors.some(n => n.row === row && n.col === col);

  if (!isValid) return false;

  player.pos.row = row;
  player.pos.col = col;
  state.remainingSteps--;

  // Immediate win if reached the end
  if (posEq(player.pos, END)) {
    state.gameOver = true;
    state.winner = player;
    state.phase = 'gameover';
    log(`${player.name} 到达终点，获胜！`);
    render();
    return true;
  }

  if (state.remainingSteps === 0) {
    resolveBoardEvent();
  } else {
    log(`${player.name} 移动到 (${row}, ${col})，剩余 ${state.remainingSteps} 步。`);
  }
  render();
  return true;
}

function resolveBoardEvent() {
  const player = currentPlayer();
  const item = getItemAt(player.pos.row, player.pos.col);

  log(`${player.name} 到达 (${player.pos.row}, ${player.pos.col})，步数用完。`);

  if (item) {
    const def = ITEM_TYPES[item.type];
    const itemRow = item.row, itemCol = item.col;
    log(`${player.name} 踩到了 ${def.label}！`);
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
      case 'potion': {
        const nearest = nearestBigMark(player.ruler);
        const oldRuler = player.ruler;
        player.ruler = nearest;
        log(`${player.name} 喝了药水，刻度尺从 ${oldRuler} 调整到 ${nearest}（最近大格）。`);
        break;
      }
    }

    removeItemAt(itemRow, itemCol);

    // Check if forced-movement landed on the end
    if (posEq(player.pos, END)) {
      state.gameOver = true;
      state.winner = player;
      state.phase = 'gameover';
      log(`${player.name} 到达终点，获胜！`);
      render();
      return;
    }
  }

  // Check if player is at the end (could have landed there naturally or via items)
  if (!state.gameOver && posEq(player.pos, END)) {
    state.gameOver = true;
    state.winner = player;
    state.phase = 'gameover';
    log(`${player.name} 到达终点，获胜！`);
    render();
    return;
  }

  switchTurn();
  render();
}

/** Move player step-by-step toward target, without triggering additional items. */
function applyForcedMovement(targetRow, targetCol, steps) {
  const player = currentPlayer();
  for (let i = 0; i < steps; i++) {
    const next = moveTowardTarget(player.pos.row, player.pos.col, targetRow, targetCol);
    if (!next) break; // shouldn't happen unless stuck
    player.pos.row = next.row;
    player.pos.col = next.col;
  }
}

function switchTurn() {
  state.currentPlayer = 1 - state.currentPlayer;
  state.diceValue = 0;
  state.phase = 'roll';
  state.remainingSteps = 0;
  log(`--- 轮到 ${currentPlayer().name} ---`);

  if (state.currentPlayer === state.aiPlayer && !state.gameOver) {
    state.phase = 'ai-thinking';
    render();
    setTimeout(() => aiDoTurn(), 150);
  } else {
    render();
  }
}

// -- AI ---------------------------------------------------------------------

function aiDoTurn() {
  if (state.gameOver || state.currentPlayer !== state.aiPlayer) return;
  rollDice();
  if (state.phase === 'move') {
    state.aiActive = true;
    render();
    setTimeout(() => aiMoveStep(), 80);
  }
}

function aiMoveStep() {
  if (state.phase !== 'move' || state.gameOver || !state.aiActive) {
    state.aiActive = false;
    render();
    return;
  }

  const player = currentPlayer();
  const best = chooseBestMove(player.pos);
  if (best) {
    tryMoveTo(best.row, best.col);
    if (state.phase === 'move') {
      setTimeout(() => aiMoveStep(), 80);
    } else {
      state.aiActive = false;
      render();
    }
  }
}

/** AI: pick neighbor closest to END, tie-break by centrality (more options). */
function chooseBestMove(pos) {
  const neighbors = getNeighbors(pos.row, pos.col);
  if (neighbors.length === 0) return null;

  neighbors.sort((a, b) => {
    const da = manhattan(a, END);
    const db = manhattan(b, END);
    if (da !== db) return da - db;
    // Tie-break: prefer more central positions (further from edges)
    const ca = Math.min(a.row, BOARD_SIZE - 1 - a.row) + Math.min(a.col, BOARD_SIZE - 1 - a.col);
    const cb = Math.min(b.row, BOARD_SIZE - 1 - b.row) + Math.min(b.col, BOARD_SIZE - 1 - b.col);
    return cb - ca;
  });

  return neighbors[0];
}

// -- Item Effects -----------------------------------------------------------

function showItemEffect(itemType, row, col) {
  const def = ITEM_TYPES[itemType];

  // 1. Flash the item cell
  const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  if (cell) {
    cell.classList.add(`item-flash-${itemType}`);
    setTimeout(() => cell.classList.remove(`item-flash-${itemType}`), 700);
  }

  // 2. Shake the board for bombs
  if (itemType === 'smallBomb' || itemType === 'bigBomb') {
    const board = document.getElementById('board');
    board.classList.add(itemType === 'bigBomb' ? 'board-shake-big' : 'board-shake');
    setTimeout(() => board.classList.remove('board-shake', 'board-shake-big'), 500);
  }

  // 3. Toast notification
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
  boardEl.innerHTML = '';

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;

      // Coordinate label
      const coord = document.createElement('span');
      coord.className = 'cell-coord';
      coord.textContent = `${r},${c}`;
      cell.appendChild(coord);

      // Start / End markers
      if (isStart(r, c)) {
        cell.classList.add('cell-start');
        const label = document.createElement('span');
        label.className = 'cell-label';
        label.textContent = '起点';
        cell.appendChild(label);
      }
      if (isEnd(r, c)) {
        cell.classList.add('cell-end');
        const label = document.createElement('span');
        label.className = 'cell-label';
        label.textContent = '终点';
        cell.appendChild(label);
      }

      // Items are hidden — not rendered on the board

      // Player pieces
      for (let pi = 0; pi < state.players.length; pi++) {
        const p = state.players[pi];
        if (p.pos.row === r && p.pos.col === c) {
          const piece = document.createElement('span');
          piece.className = `piece ${p.cssClass}`;
          piece.textContent = '♛';
          cell.appendChild(piece);
        }
      }

      // Click handler for movement (human player only)
      cell.addEventListener('click', () => {
        if (state.phase === 'move' && !state.gameOver && state.currentPlayer !== state.aiPlayer) {
          tryMoveTo(r, c);
        }
      });

      // Highlight valid moves (only for human player)
      if (state.phase === 'move' && !state.gameOver && state.currentPlayer !== state.aiPlayer) {
        const cp = currentPlayer();
        const neighbors = getNeighbors(cp.pos.row, cp.pos.col);
        const isNeighbor = neighbors.some(n => n.row === r && n.col === c);
        if (isNeighbor) {
          cell.classList.add('cell-movable');
        }
      }

      boardEl.appendChild(cell);
    }
  }
}

function renderRulers() {
  for (let pi = 0; pi < 2; pi++) {
    const player = state.players[pi];
    const rulerEl = document.getElementById(`ruler-p${pi}`);
    const valueEl = document.getElementById(`ruler-value-p${pi}`);
    const barEl = document.getElementById(`ruler-bar-p${pi}`);

    const pct = (player.ruler / RULER_MAX) * 100;
    barEl.style.width = `${pct}%`;
    valueEl.textContent = player.ruler;

    // Highlight active player
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

  rollBtn.disabled = (state.phase !== 'roll' || state.gameOver || state.currentPlayer === state.aiPlayer);
}

function getDiceFace(n) {
  const faces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  return faces[n] || '🎲';
}

function renderTurnInfo() {
  const turnEl = document.getElementById('turn-indicator');
  if (state.gameOver) {
    turnEl.textContent = `🏆 ${state.winner.name} 获胜！`;
    turnEl.className = 'turn-banner winner';
  } else {
    const p = currentPlayer();
    const aiTag = (state.currentPlayer === state.aiPlayer) ? ' (AI)' : '';
    turnEl.textContent = `当前回合：${p.name}${aiTag}`;
    turnEl.className = `turn-banner ${p.cssClass.replace('piece-', 'turn-')}`;
    if (state.phase === 'ai-thinking') {
      turnEl.textContent += ' — AI 思考中...';
    } else if (state.phase === 'move') {
      turnEl.textContent += (state.currentPlayer === state.aiPlayer) ? ' — AI 移动中...' : ' — 可移动！';
    }
  }
}

function renderMoveInfo() {
  const moveEl = document.getElementById('move-info');
  if (state.phase === 'move' && !state.gameOver) {
    moveEl.textContent = `剩余移动步数：${state.remainingSteps}`;
    moveEl.style.display = 'block';
  } else {
    moveEl.style.display = 'none';
  }
}

function renderLog() {
  const logEl = document.getElementById('log-list');
  logEl.innerHTML = '';
  // Show newest first
  const entries = state.log.slice(0, 20);
  for (const entry of entries) {
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

document.addEventListener('DOMContentLoaded', () => {
  initRulerTicks();
  document.getElementById('roll-btn').addEventListener('click', rollDice);
  document.getElementById('restart-btn').addEventListener('click', startNewGame);
  document.getElementById('new-game-btn').addEventListener('click', startNewGame);
  startNewGame();
});
