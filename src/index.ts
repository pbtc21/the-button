import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  TREASURY_ADDRESS: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

// sBTC token contract on mainnet
const SBTC_CONTRACT = 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-sbtc'
const PRESS_COST_SATS = 1000 // 1000 sats = 0.00001 BTC per press

// In-memory game state (would use D1/KV in production)
let gameState = {
  timer: 60,
  lastPresser: null as string | null,
  lastPressTime: Date.now(),
  started: false, // Game hasn't started until first press
  pot: 0,
  pressCount: 0,
  players: new Map<string, { presses: number, lastPress: number, color: string }>(),
  history: [] as { player: string, time: number, timerAt: number }[],
  gameOver: false,
  winner: null as string | null,
  round: 1
}

// Color based on when you pressed (like Reddit's button)
function getPresserColor(timerAt: number): string {
  if (timerAt > 50) return '#9c59d1' // Purple - early presser
  if (timerAt > 40) return '#4287f5' // Blue
  if (timerAt > 30) return '#42f5a7' // Green
  if (timerAt > 20) return '#f5e642' // Yellow
  if (timerAt > 10) return '#f5a442' // Orange
  return '#f54242' // Red - danger zone presser
}

function getFlairName(timerAt: number): string {
  if (timerAt > 50) return 'Early Bird'
  if (timerAt > 40) return 'Cautious'
  if (timerAt > 30) return 'Moderate'
  if (timerAt > 20) return 'Risk Taker'
  if (timerAt > 10) return 'Daredevil'
  return 'Madlad'
}

// Main game page
app.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Stacks Button</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #1a1a2e;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    h1 {
      font-size: 2.5rem;
      margin: 20px 0;
      text-align: center;
    }
    .subtitle {
      color: #888;
      margin-bottom: 30px;
      text-align: center;
    }
    .game-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 30px;
      max-width: 800px;
      width: 100%;
    }
    .timer-container {
      position: relative;
      width: 300px;
      height: 300px;
    }
    .timer-ring {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: conic-gradient(
        from 0deg,
        #9c59d1 0deg,
        #4287f5 60deg,
        #42f5a7 120deg,
        #f5e642 180deg,
        #f5a442 240deg,
        #f54242 300deg,
        #f54242 360deg
      );
      mask: radial-gradient(transparent 65%, black 65%);
      -webkit-mask: radial-gradient(transparent 65%, black 65%);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.8; }
      50% { opacity: 1; }
    }
    .timer-inner {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 200px;
      height: 200px;
      background: #1a1a2e;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .timer-value {
      font-size: 4rem;
      font-weight: bold;
      font-family: monospace;
    }
    .timer-label {
      color: #888;
      font-size: 0.9rem;
    }
    .button-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 15px;
    }
    #pressButton {
      width: 200px;
      height: 200px;
      border-radius: 50%;
      border: none;
      background: linear-gradient(145deg, #e63946, #c1121f);
      color: white;
      font-size: 1.5rem;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 10px 30px rgba(230, 57, 70, 0.4);
      transition: all 0.1s;
      text-transform: uppercase;
    }
    #pressButton:hover {
      transform: scale(1.05);
      box-shadow: 0 15px 40px rgba(230, 57, 70, 0.6);
    }
    #pressButton:active {
      transform: scale(0.95);
    }
    #pressButton:disabled {
      background: #333;
      cursor: not-allowed;
      box-shadow: none;
    }
    .input-group {
      display: flex;
      gap: 10px;
    }
    #playerName {
      padding: 10px 15px;
      border-radius: 8px;
      border: 2px solid #333;
      background: #16213e;
      color: #fff;
      font-size: 1rem;
      width: 200px;
    }
    #playerName:focus {
      outline: none;
      border-color: #e63946;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      width: 100%;
      max-width: 500px;
    }
    .stat {
      background: #16213e;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
    }
    .stat-value {
      font-size: 1.8rem;
      font-weight: bold;
      color: #e63946;
    }
    .stat-label {
      color: #888;
      font-size: 0.8rem;
      margin-top: 5px;
    }
    .last-presser {
      background: #16213e;
      padding: 15px 30px;
      border-radius: 12px;
      text-align: center;
    }
    .last-presser-name {
      font-size: 1.2rem;
      font-weight: bold;
    }
    .history {
      background: #16213e;
      border-radius: 12px;
      padding: 20px;
      width: 100%;
      max-height: 300px;
      overflow-y: auto;
    }
    .history h3 {
      margin-bottom: 15px;
      color: #888;
    }
    .history-item {
      display: flex;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #333;
    }
    .history-item:last-child {
      border-bottom: none;
    }
    .flair {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 10px;
    }
    .history-name {
      flex: 1;
    }
    .history-timer {
      color: #888;
      font-family: monospace;
    }
    .game-over {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .game-over h2 {
      font-size: 3rem;
      color: #e63946;
      margin-bottom: 20px;
    }
    .game-over .winner {
      font-size: 2rem;
      margin-bottom: 30px;
    }
    .game-over button {
      padding: 15px 40px;
      font-size: 1.2rem;
      border: none;
      border-radius: 8px;
      background: #e63946;
      color: white;
      cursor: pointer;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>🔴 THE BUTTON</h1>
  <p class="subtitle">Press it to reset. When it hits zero, last presser wins the pot.</p>

  <div class="game-container">
    <div class="timer-container">
      <div class="timer-ring" id="timerRing"></div>
      <div class="timer-inner">
        <div class="timer-value" id="timer">60</div>
        <div class="timer-label">seconds</div>
      </div>
    </div>

    <div class="button-container">
      <div class="input-group">
        <input type="text" id="playerName" placeholder="Your name or wallet" maxlength="20" />
      </div>
      <button id="pressButton" onclick="pressButton()">PRESS</button>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value" id="pot">0</div>
        <div class="stat-label">POT (STX)</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="presses">0</div>
        <div class="stat-label">TOTAL PRESSES</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="players">0</div>
        <div class="stat-label">PLAYERS</div>
      </div>
    </div>

    <div class="last-presser">
      <div style="color: #888; font-size: 0.8rem;">LAST PRESSER</div>
      <div class="last-presser-name" id="lastPresser">---</div>
    </div>

    <div class="history">
      <h3>Recent Presses</h3>
      <div id="historyList"></div>
    </div>
  </div>

  <div class="game-over hidden" id="gameOver">
    <h2>🎉 GAME OVER!</h2>
    <div class="winner">Winner: <span id="winnerName">---</span></div>
    <div style="margin-bottom: 20px;">Won the pot of <span id="winnerPot">0</span> STX!</div>
    <button onclick="newRound()">NEW ROUND</button>
  </div>

  <script>
    let localTimer = 60;
    let gameOver = false;

    async function fetchState() {
      try {
        const res = await fetch('/api/state');
        const state = await res.json();

        localTimer = state.timer;
        document.getElementById('timer').textContent = Math.max(0, Math.floor(state.timer));
        document.getElementById('pot').textContent = state.pot.toFixed(2);
        document.getElementById('presses').textContent = state.pressCount;
        document.getElementById('players').textContent = state.playerCount;
        document.getElementById('lastPresser').textContent = state.lastPresser || '---';

        // Update timer ring
        const ring = document.getElementById('timerRing');
        const progress = (state.timer / 60) * 360;
        ring.style.background = \`conic-gradient(
          from 0deg,
          #9c59d1 0deg,
          #4287f5 \${progress * 0.2}deg,
          #42f5a7 \${progress * 0.4}deg,
          #f5e642 \${progress * 0.6}deg,
          #f5a442 \${progress * 0.8}deg,
          #f54242 \${progress}deg,
          #333 \${progress}deg
        )\`;

        // Update history
        const historyList = document.getElementById('historyList');
        historyList.innerHTML = state.history.slice(0, 20).map(h => \`
          <div class="history-item">
            <div class="flair" style="background: \${h.color}"></div>
            <div class="history-name">\${h.player}</div>
            <div class="history-timer">\${h.timerAt.toFixed(1)}s</div>
          </div>
        \`).join('');

        // Check game over
        if (state.gameOver && !gameOver) {
          gameOver = true;
          document.getElementById('gameOver').classList.remove('hidden');
          document.getElementById('winnerName').textContent = state.winner || 'Nobody';
          document.getElementById('winnerPot').textContent = state.pot.toFixed(2);
        }

      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    async function pressButton() {
      const name = document.getElementById('playerName').value.trim() || 'Anon-' + Math.random().toString(36).slice(2, 6);
      document.getElementById('playerName').value = name;

      try {
        const res = await fetch('/api/press', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ player: name })
        });
        const result = await res.json();

        if (result.success) {
          // Visual feedback
          const btn = document.getElementById('pressButton');
          btn.style.transform = 'scale(0.9)';
          setTimeout(() => btn.style.transform = '', 100);

          fetchState();
        }
      } catch (e) {
        console.error('Press error:', e);
      }
    }

    async function newRound() {
      try {
        await fetch('/api/reset', { method: 'POST' });
        gameOver = false;
        document.getElementById('gameOver').classList.add('hidden');
        fetchState();
      } catch (e) {
        console.error('Reset error:', e);
      }
    }

    // Countdown locally for smooth display
    function localCountdown() {
      if (!gameOver && localTimer > 0) {
        localTimer -= 0.1;
        document.getElementById('timer').textContent = Math.max(0, Math.floor(localTimer));
      }
    }

    // Keyboard support
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !gameOver) {
        e.preventDefault();
        pressButton();
      }
    });

    // Start
    fetchState();
    setInterval(fetchState, 1000);
    setInterval(localCountdown, 100);
  </script>
</body>
</html>`;
  return c.html(html);
});

// Get game state
app.get('/api/state', (c) => {
  // If game hasn't started, show full timer waiting for first press
  if (!gameState.started) {
    return c.json({
      timer: 60,
      lastPresser: null,
      pot: 0,
      pressCount: 0,
      playerCount: 0,
      history: [],
      gameOver: false,
      winner: null,
      round: gameState.round,
      waiting: true
    });
  }

  // Calculate current timer
  const elapsed = (Date.now() - gameState.lastPressTime) / 1000;
  const currentTimer = Math.max(0, gameState.timer - elapsed);

  // Check if game over
  if (currentTimer <= 0 && !gameState.gameOver && gameState.lastPresser) {
    gameState.gameOver = true;
    gameState.winner = gameState.lastPresser;
  }

  return c.json({
    timer: currentTimer,
    lastPresser: gameState.lastPresser,
    pot: gameState.pot,
    pressCount: gameState.pressCount,
    playerCount: gameState.players.size,
    history: gameState.history.slice(0, 20),
    gameOver: gameState.gameOver,
    winner: gameState.winner,
    round: gameState.round,
    waiting: false
  });
});

// Helper function to process a press
function processPress(player: string): { success: boolean, error?: string, timer?: number, color?: string, flair?: string, pot?: number } {
  if (gameState.gameOver) {
    return { success: false, error: 'Game over' };
  }

  let currentTimer = 60;
  if (!gameState.started) {
    gameState.started = true;
    gameState.lastPressTime = Date.now();
  } else {
    const elapsed = (Date.now() - gameState.lastPressTime) / 1000;
    currentTimer = Math.max(0, gameState.timer - elapsed);

    if (currentTimer <= 0) {
      gameState.gameOver = true;
      gameState.winner = gameState.lastPresser;
      return { success: false, error: 'Too late!' };
    }
  }

  const color = getPresserColor(currentTimer);
  const flair = getFlairName(currentTimer);

  gameState.timer = 60;
  gameState.lastPressTime = Date.now();
  gameState.lastPresser = player;
  gameState.pressCount++;

  const playerStats = gameState.players.get(player) || { presses: 0, lastPress: 0, color: '' };
  playerStats.presses++;
  playerStats.lastPress = Date.now();
  playerStats.color = color;
  gameState.players.set(player, playerStats);

  gameState.history.unshift({
    player,
    time: Date.now(),
    timerAt: currentTimer,
    color,
    flair
  } as any);

  if (gameState.history.length > 100) {
    gameState.history = gameState.history.slice(0, 100);
  }

  return { success: true, timer: 60, color, flair, pot: gameState.pot };
}

// Press the button (free play mode)
app.post('/api/press', async (c) => {
  const body = await c.req.json();
  const player = body.player?.slice(0, 20) || 'Anonymous';

  gameState.pot += 0.001; // Simulated cost
  const result = processPress(player);
  return c.json({ ...result, mode: 'free' });
});

// Press with sBTC payment (real Bitcoin mode)
app.post('/api/press-sbtc', async (c) => {
  const payment = c.req.header('X-PAYMENT');
  const body = await c.req.json();
  const player = body.player?.slice(0, 42) || 'Anonymous';

  // If no payment header, return 402 with payment requirements
  if (!payment) {
    const nonce = crypto.randomUUID();
    return c.json({
      error: 'Payment required',
      payment: {
        currency: 'sBTC',
        amount: PRESS_COST_SATS,
        amountBTC: PRESS_COST_SATS / 100000000,
        recipient: c.env.TREASURY_ADDRESS || 'SP2J6CYV7YEBQANTA668TVB2PE30EE09J2XN5SFVS',
        memo: nonce,
        contract: SBTC_CONTRACT,
        instructions: 'Send sBTC transfer with memo, include signed tx in X-PAYMENT header'
      },
      nonce
    }, 402);
  }

  // Verify and broadcast the payment
  try {
    const txRes = await fetch('https://api.hiro.so/v2/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/hex' },
      body: payment
    });

    if (!txRes.ok) {
      const err = await txRes.text();
      return c.json({ success: false, error: 'Payment failed: ' + err }, 400);
    }

    const txData = await txRes.json() as any;
    const txId = txData.txid;

    // Payment accepted - add to pot and process press
    gameState.pot += PRESS_COST_SATS / 100000000;
    const result = processPress(player);

    return c.json({ ...result, txId, mode: 'sbtc' });

  } catch (err) {
    return c.json({ success: false, error: 'Payment verification failed' }, 400);
  }
});

// Reset for new round
app.post('/api/reset', (c) => {
  gameState = {
    timer: 60,
    lastPresser: null,
    lastPressTime: Date.now(),
    started: false, // Wait for first press
    pot: 0,
    pressCount: 0,
    players: new Map(),
    history: [],
    gameOver: false,
    winner: null,
    round: gameState.round + 1
  };

  return c.json({ success: true, round: gameState.round });
});

// API for Claude agents
app.get('/api/agent', (c) => {
  let currentTimer = 60;
  if (gameState.started) {
    const elapsed = (Date.now() - gameState.lastPressTime) / 1000;
    currentTimer = Math.max(0, gameState.timer - elapsed);
  }

  return c.json({
    description: 'The Button - Press to reset the timer. When it hits 0, last presser wins.',
    timer: currentTimer,
    pot: gameState.pot,
    lastPresser: gameState.lastPresser,
    pressCount: gameState.pressCount,
    gameOver: gameState.gameOver,
    actions: {
      press: {
        method: 'POST',
        endpoint: '/api/press',
        body: { player: 'your-identifier' },
        cost: '0.001 STX equivalent'
      }
    },
    strategy_hints: [
      'Press early to reset and be safe',
      'Press late for the "Madlad" flair',
      'Watch the timer - if no one presses, you win',
      'Coordinate with others to split the pot?'
    ]
  });
});

app.get('/health', (c) => c.json({ status: 'button ready', round: gameState.round }));

export default app;
