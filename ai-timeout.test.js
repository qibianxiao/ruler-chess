const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement() {
  return {
    className: '',
    dataset: {},
    style: {},
    innerHTML: '',
    textContent: '',
    disabled: false,
    appendChild() {},
    addEventListener() {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
  };
}

function loadGame() {
  const timeouts = [];
  let now = 0;
  const elements = new Map();

  const document = {
    addEventListener(event, handler) {
      if (event === 'DOMContentLoaded') document.ready = handler;
    },
    createElement,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelector() {
      return null;
    },
  };

  const context = {
    console,
    document,
    performance: { now: () => now },
    setTimeout(callback, delay) {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
    clearTimeout() {},
    __advanceTime(ms) {
      now += ms;
    },
  };

  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
  vm.runInContext(`${source}
globalThis.__game = {
  state,
  START,
  AI_THINK_TIME_LIMIT_MS: typeof AI_THINK_TIME_LIMIT_MS === 'undefined' ? undefined : AI_THINK_TIME_LIMIT_MS,
  AI_TURN_START_DELAY_MS: typeof AI_TURN_START_DELAY_MS === 'undefined' ? undefined : AI_TURN_START_DELAY_MS,
  startNewGame,
  aiDoTurn,
  __setRandInt(fn) { randInt = fn; },
  __setChooseBestMove(fn) { chooseBestMove = fn; },
  __setRender(fn) { render = fn; },
};`, context);

  return { api: context.__game, timeouts, context };
}

function testAiLimitIsFiveSeconds() {
  const { api } = loadGame();
  assert.equal(api.AI_THINK_TIME_LIMIT_MS, 5000);
}

function testAiTurnIsScheduledAfterInitialRender() {
  const { api, timeouts } = loadGame();

  api.startNewGame();

  assert.equal(api.state.phase, 'ai-thinking');
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delay, api.AI_TURN_START_DELAY_MS);
}

function testAiFallsBackAndFinishesTurnWhenPlannerMissesDeadline() {
  const { api, context } = loadGame();
  let plannerCalls = 0;

  api.__setRandInt(() => 5);
  api.__setChooseBestMove(() => {
    plannerCalls++;
    context.__advanceTime(6000);
    return null;
  });

  api.state.players[0].ruler = 0;
  api.state.players[0].pos = { ...api.START };
  api.state.players[1].ruler = 0;
  api.state.players[1].pos = { ...api.START };
  api.state.currentPlayer = 0;
  api.state.phase = 'roll';
  api.state.remainingSteps = 0;
  api.state.items = [];
  api.state.gameOver = false;
  api.state.winner = null;

  api.aiDoTurn();

  assert.equal(plannerCalls, 1);
  assert.equal(api.state.aiActive, false);
  assert.equal(api.state.currentPlayer, 1);
  assert.equal(api.state.phase, 'roll');
  assert.notDeepEqual(api.state.players[0].pos, api.START);
}

function testAiRendersWhenDiceDoesNotLandOnBigMark() {
  const { api } = loadGame();
  let renderCalls = 0;

  api.__setRandInt(() => 1);
  api.__setRender(() => {
    renderCalls++;
  });

  api.state.players[0].ruler = 0;
  api.state.players[0].pos = { ...api.START };
  api.state.players[1].ruler = 0;
  api.state.players[1].pos = { ...api.START };
  api.state.currentPlayer = 0;
  api.state.phase = 'roll';
  api.state.remainingSteps = 0;
  api.state.items = [];
  api.state.gameOver = false;
  api.state.winner = null;

  api.aiDoTurn();

  assert.equal(api.state.currentPlayer, 1);
  assert.equal(api.state.phase, 'roll');
  assert.ok(renderCalls >= 1);
}

testAiLimitIsFiveSeconds();
testAiTurnIsScheduledAfterInitialRender();
testAiFallsBackAndFinishesTurnWhenPlannerMissesDeadline();
testAiRendersWhenDiceDoesNotLandOnBigMark();
console.log('AI timeout tests passed');
