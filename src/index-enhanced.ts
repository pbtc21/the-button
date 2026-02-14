import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  TREASURY_ADDRESS: string
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

// sBTC token contract on mainnet
const SBTC_CONTRACT = 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-sbtc'
const PRESS_COST_SATS = 1000 // 1000 sats = 0.00001 BTC per press

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

// Database helpers
async function getCurrentGameState(db: D1Database) {
  const result = await db.prepare('SELECT * FROM game_state WHERE id = 1').first()
  return result || {
    current_round: 1,
    timer: 60,
    last_press_time: null,
    last_presser: null,
    started: false,
    game_over: false,
    pot: 0,
    press_count: 0
  }
}

async function getRecentPresses(db: D1Database, limit = 20) {
  const { results } = await db.prepare(`
    SELECT p.*, r.round_number 
    FROM presses p
    JOIN game_rounds r ON p.round_id = r.id
    ORDER BY p.press_time DESC 
    LIMIT ?
  `).bind(limit).all()
  return results
}

async function getLeaderboard(db: D1Database) {
  const { results } = await db.prepare(`
    SELECT 
      name,
      total_presses,
      total_spent,
      total_won,
      (total_won - total_spent) as net_profit,
      CASE WHEN total_spent > 0 THEN (total_won / total_spent) ELSE 0 END as roi
    FROM players 
    ORDER BY total_presses DESC, total_won DESC
    LIMIT 50
  `).all()
  return results
}

async function upsertPlayer(db: D1Database, name: string, walletAddress?: string) {
  const now = Date.now()
  return await db.prepare(`
    INSERT INTO players (name, wallet_address, first_seen, last_seen, total_presses, total_spent, total_won)
    VALUES (?, ?, ?, ?, 0, 0, 0)
    ON CONFLICT(name) DO UPDATE SET 
      last_seen = ?,
      wallet_address = COALESCE(wallet_address, ?)
  `).bind(name, walletAddress, now, now, now, walletAddress).run()
}

async function recordPress(db: D1Database, roundId: number, playerName: string, timerAt: number, paymentTxid?: string, paymentAmount?: number) {
  const color = getPresserColor(timerAt)
  const flair = getFlairName(timerAt)
  const now = Date.now()

  // Insert the press
  await db.prepare(`
    INSERT INTO presses (round_id, player_name, press_time, timer_at, payment_txid, payment_amount, color, flair)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(roundId, playerName, now, timerAt, paymentTxid, paymentAmount || 0, color, flair).run()

  // Update player stats
  await db.prepare(`
    UPDATE players 
    SET total_presses = total_presses + 1,
        total_spent = total_spent + ?,
        last_seen = ?
    WHERE name = ?
  `).bind(paymentAmount || 0.001, now, playerName).run()

  // Update game state
  await db.prepare(`
    UPDATE game_state 
    SET timer = 60,
        last_press_time = ?,
        last_presser = ?,
        started = TRUE,
        pot = pot + ?,
        press_count = press_count + 1
    WHERE id = 1
  `).bind(now, playerName, paymentAmount || 0.001).run()

  return { color, flair }
}

async function endGame(db: D1Database) {
  const state = await getCurrentGameState(db)
  if (state.game_over) return

  // Mark game as over
  await db.prepare('UPDATE game_state SET game_over = TRUE WHERE id = 1').run()

  // Award the pot to the winner
  if (state.last_presser && state.pot > 0) {
    await db.prepare(`
      UPDATE players 
      SET total_won = total_won + ?
      WHERE name = ?
    `).bind(state.pot, state.last_presser).run()

    // Mark round as finished
    await db.prepare(`
      UPDATE game_rounds 
      SET end_time = ?, winner = ?, total_pot = ?, total_presses = ?
      WHERE round_number = ?
    `).bind(Date.now(), state.last_presser, state.pot, state.press_count, state.current_round).run()
  }
}

async function startNewRound(db: D1Database) {
  const state = await getCurrentGameState(db)
  const newRound = state.current_round + 1
  const now = Date.now()

  // Create new round
  await db.prepare(`
    INSERT INTO game_rounds (round_number, start_time, status)
    VALUES (?, ?, 'active')
  `).bind(newRound, now).run()

  // Reset game state
  await db.prepare(`
    UPDATE game_state 
    SET current_round = ?,
        timer = 60,
        last_press_time = NULL,
        last_presser = NULL,
        started = FALSE,
        game_over = FALSE,
        pot = 0,
        press_count = 0
    WHERE id = 1
  `).bind(newRound).run()
}

// Main game page with enhanced UI including leaderboard
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
      max-width: 600px;
    }
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 30px;
    }
    .tab {
      padding: 10px 20px;
      border: 2px solid #333;
      border-radius: 8px;
      background: transparent;
      color: #888;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab.active {
      border-color: #e63946;
      color: #e63946;
      background: rgba(230, 57, 70, 0.1);
    }
    .tab-content {
      display: none;
      width: 100%;
      max-width: 800px;
    }
    .tab-content.active {
      display: block;
    }
    .game-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 30px;
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
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 20px;
      width: 100%;
      max-width: 600px;
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
      width: 100%;
    }
    .last-presser-name {
      font-size: 1.2rem;
      font-weight: bold;
    }
    .history, .leaderboard {
      background: #16213e;
      border-radius: 12px;
      padding: 20px;
      width: 100%;
    }
    .history {
      max-height: 400px;
      overflow-y: auto;
    }
    .leaderboard {
      max-height: 600px;
      overflow-y: auto;
    }
    .history h3, .leaderboard h3 {
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
    .leaderboard-item {
      display: grid;
      grid-template-columns: 40px 1fr 80px 80px 80px;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid #333;
      align-items: center;
    }
    .leaderboard-item:last-child {
      border-bottom: none;
    }
    .leaderboard-rank {
      font-weight: bold;
      color: #e63946;
    }
    .leaderboard-name {
      font-weight: bold;
    }
    .leaderboard-stat {
      text-align: right;
      font-family: monospace;
      font-size: 0.9rem;
    }
    .profit-positive {
      color: #42f5a7;
    }
    .profit-negative {
      color: #f54242;
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
    .round-info {
      background: #16213e;
      padding: 10px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      text-align: center;
      color: #888;
    }
  </style>
</head>
<body>
  <h1>🔴 THE BUTTON</h1>
  <p class="subtitle">Press it to reset the timer. When it hits zero, the last presser wins the entire pot! Now with persistent leaderboard and D1 database.</p>

  <div class="tabs">
    <button class="tab active" onclick="switchTab('game')">GAME</button>
    <button class="tab" onclick="switchTab('leaderboard')">LEADERBOARD</button>
    <button class="tab" onclick="switchTab('history')">HISTORY</button>
  </div>

  <div id="gameTab" class="tab-content active">
    <div class="round-info">
      Round <span id="roundNumber">1</span>
    </div>

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
          <div class="stat-label">POT (sBTC)</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="presses">0</div>
          <div class="stat-label">TOTAL PRESSES</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="players">0</div>
          <div class="stat-label">PLAYERS</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="totalGames">1</div>
          <div class="stat-label">TOTAL GAMES</div>
        </div>
      </div>

      <div class="last-presser">
        <div style="color: #888; font-size: 0.8rem;">LAST PRESSER</div>
        <div class="last-presser-name" id="lastPresser">---</div>
      </div>
    </div>
  </div>

  <div id="leaderboardTab" class="tab-content">
    <div class="leaderboard">
      <h3>🏆 All-Time Leaderboard</h3>
      <div class="leaderboard-item" style="font-weight: bold; color: #888; border-bottom: 2px solid #333;">
        <div>#</div>
        <div>Player</div>
        <div>Presses</div>
        <div>Won</div>
        <div>Profit</div>
      </div>
      <div id="leaderboardList"></div>
    </div>
  </div>

  <div id="historyTab" class="tab-content">
    <div class="history">
      <h3>📜 Recent Presses (All Rounds)</h3>
      <div id="historyList"></div>
    </div>
  </div>

  <div class="game-over hidden" id="gameOver">
    <h2>🎉 GAME OVER!</h2>
    <div class="winner">Winner: <span id="winnerName">---</span></div>
    <div style="margin-bottom: 20px;">Won the pot of <span id="winnerPot">0</span> sBTC!</div>
    <button onclick="newRound()">NEW ROUND</button>
  </div>

  <script>
    let localTimer = 60;
    let gameOver = false;
    let currentTab = 'game';

    function switchTab(tab) {
      // Update tab buttons
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector(\`.tab:nth-child(\${tab === 'game' ? 1 : tab === 'leaderboard' ? 2 : 3})\`).classList.add('active');
      
      // Update tab content
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById(tab + 'Tab').classList.add('active');
      
      currentTab = tab;
      
      if (tab === 'leaderboard') fetchLeaderboard();
      if (tab === 'history') fetchHistory();
    }

    async function fetchState() {
      try {
        const res = await fetch('/api/state');
        const state = await res.json();

        localTimer = state.timer;
        document.getElementById('timer').textContent = Math.max(0, Math.floor(state.timer));
        document.getElementById('pot').textContent = state.pot.toFixed(6);
        document.getElementById('presses').textContent = state.pressCount;
        document.getElementById('players').textContent = state.playerCount;
        document.getElementById('lastPresser').textContent = state.lastPresser || '---';
        document.getElementById('roundNumber').textContent = state.round;
        document.getElementById('totalGames').textContent = state.totalGames || 1;

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

        // Check game over
        if (state.gameOver && !gameOver) {
          gameOver = true;
          document.getElementById('gameOver').classList.remove('hidden');
          document.getElementById('winnerName').textContent = state.winner || 'Nobody';
          document.getElementById('winnerPot').textContent = state.pot.toFixed(6);
        }

      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    async function fetchLeaderboard() {
      try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        
        const list = document.getElementById('leaderboardList');
        list.innerHTML = data.leaderboard.map((player, i) => \`
          <div class="leaderboard-item">
            <div class="leaderboard-rank">\${i + 1}</div>
            <div class="leaderboard-name">\${player.name}</div>
            <div class="leaderboard-stat">\${player.total_presses}</div>
            <div class="leaderboard-stat">\${(player.total_won).toFixed(4)}</div>
            <div class="leaderboard-stat \${player.net_profit >= 0 ? 'profit-positive' : 'profit-negative'}">
              \${player.net_profit >= 0 ? '+' : ''}\${(player.net_profit).toFixed(4)}
            </div>
          </div>
        \`).join('');
      } catch (e) {
        console.error('Leaderboard error:', e);
      }
    }

    async function fetchHistory() {
      try {
        const res = await fetch('/api/history');
        const data = await res.json();
        
        const list = document.getElementById('historyList');
        list.innerHTML = data.history.map(h => \`
          <div class="history-item">
            <div class="flair" style="background: \${h.color}"></div>
            <div class="history-name">\${h.player_name} (R\${h.round_number})</div>
            <div class="history-timer">\${h.timer_at.toFixed(1)}s</div>
          </div>
        \`).join('');
      } catch (e) {
        console.error('History error:', e);
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
        } else {
          alert('Press failed: ' + result.error);
        }
      } catch (e) {
        console.error('Press error:', e);
        alert('Network error. Please try again.');
      }
    }

    async function newRound() {
      try {
        await fetch('/api/reset', { method: 'POST' });
        gameOver = false;
        document.getElementById('gameOver').classList.add('hidden');
        fetchState();
        if (currentTab === 'leaderboard') fetchLeaderboard();
        if (currentTab === 'history') fetchHistory();
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
      if (e.code === 'Space' && !gameOver && currentTab === 'game') {
        e.preventDefault();
        pressButton();
      }
    });

    // Start
    fetchState();
    setInterval(fetchState, 2000);
    setInterval(localCountdown, 100);
  </script>
</body>
</html>`;
  return c.html(html);
});

// Get game state from database
app.get('/api/state', async (c) => {
  const state = await getCurrentGameState(c.env.DB)
  
  // If game hasn't started, show full timer waiting for first press
  if (!state.started) {
    const totalRounds = await c.env.DB.prepare('SELECT COUNT(*) as count FROM game_rounds').first()
    return c.json({
      timer: 60,
      lastPresser: null,
      pot: 0,
      pressCount: 0,
      playerCount: 0,
      gameOver: false,
      winner: null,
      round: state.current_round,
      totalGames: totalRounds?.count || 1,
      waiting: true
    });
  }

  // Calculate current timer
  const elapsed = (Date.now() - state.last_press_time) / 1000;
  const currentTimer = Math.max(0, state.timer - elapsed);

  // Check if game should end
  if (currentTimer <= 0 && !state.game_over && state.last_presser) {
    await endGame(c.env.DB);
    state.game_over = true;
    state.winner = state.last_presser;
  }

  const playerCount = await c.env.DB.prepare('SELECT COUNT(DISTINCT name) as count FROM players').first()
  const totalRounds = await c.env.DB.prepare('SELECT COUNT(*) as count FROM game_rounds').first()

  return c.json({
    timer: currentTimer,
    lastPresser: state.last_presser,
    pot: state.pot,
    pressCount: state.press_count,
    playerCount: playerCount?.count || 0,
    gameOver: state.game_over,
    winner: state.winner,
    round: state.current_round,
    totalGames: totalRounds?.count || 1,
    waiting: false
  });
});

// Get leaderboard
app.get('/api/leaderboard', async (c) => {
  const leaderboard = await getLeaderboard(c.env.DB)
  return c.json({ leaderboard })
});

// Get press history
app.get('/api/history', async (c) => {
  const history = await getRecentPresses(c.env.DB, 50)
  return c.json({ history })
});

// Press the button (free play mode)
app.post('/api/press', async (c) => {
  const body = await c.req.json()
  const player = body.player?.slice(0, 20) || 'Anonymous'

  const state = await getCurrentGameState(c.env.DB)
  
  if (state.game_over) {
    return c.json({ success: false, error: 'Game over! Start a new round.' })
  }

  let currentTimer = 60
  if (state.started) {
    const elapsed = (Date.now() - state.last_press_time) / 1000
    currentTimer = Math.max(0, state.timer - elapsed)
    
    if (currentTimer <= 0) {
      await endGame(c.env.DB)
      return c.json({ success: false, error: 'Too late! Game over.' })
    }
  }

  // Get current round
  const round = await c.env.DB.prepare('SELECT id FROM game_rounds WHERE round_number = ?').bind(state.current_round).first()
  
  // Ensure player exists
  await upsertPlayer(c.env.DB, player)
  
  // Record the press
  const { color, flair } = await recordPress(c.env.DB, round.id, player, currentTimer, null, 0.001)
  
  return c.json({ 
    success: true, 
    timer: 60, 
    color, 
    flair, 
    mode: 'free',
    pot: state.pot + 0.001
  })
});

// Enhanced x402 discovery endpoint
app.get('/api/press-sbtc', (c) => {
  return c.json({
    x402Version: 1,
    name: 'The Button - sBTC Edition',
    description: 'Press to reset the 60-second timer using sBTC. Last presser wins the entire pot when timer hits zero!',
    image: 'https://the-button.workers.dev/button.png',
    accepts: [{
      scheme: 'exact',
      network: 'stacks',
      maxAmountRequired: String(PRESS_COST_SATS),
      resource: '/api/press-sbtc',
      description: 'Press The Button with real sBTC - reset timer, compete for the pot (1000 sats)',
      mimeType: 'application/json',
      payTo: c.env.TREASURY_ADDRESS || 'SPKH9AWG0ENZ87J1X0PBD4HETP22G8W22AFNVF8K',
      maxTimeoutSeconds: 300,
      asset: 'sBTC',
      outputSchema: {
        input: { type: 'http', method: 'POST', bodyType: 'json' },
        output: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            timer: { type: 'number' },
            color: { type: 'string' },
            flair: { type: 'string' },
            txId: { type: 'string' },
            pot: { type: 'number' },
            pressCount: { type: 'number' },
            round: { type: 'number' }
          }
        }
      }
    }]
  });
});

// Press with sBTC payment (real Bitcoin mode) - Enhanced
app.post('/api/press-sbtc', async (c) => {
  const payment = c.req.header('X-PAYMENT');

  // If no payment header, return 402 with x402-compatible payment requirements
  if (!payment) {
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min expiry
    const state = await getCurrentGameState(c.env.DB);

    return c.json({
      // x402 standard fields
      maxAmountRequired: String(PRESS_COST_SATS),
      resource: '/api/press-sbtc',
      payTo: c.env.TREASURY_ADDRESS || 'SPKH9AWG0ENZ87J1X0PBD4HETP22G8W22AFNVF8K',
      network: 'mainnet',
      nonce,
      expiresAt,
      tokenType: 'sBTC',
      tokenContract: SBTC_CONTRACT,
      pricing: {
        type: 'fixed',
        tier: 'standard'
      },
      // Game context
      description: 'Press The Button - reset timer, compete for the pot!',
      instructions: 'Send 1000 sats of sBTC, include signed tx hex in X-PAYMENT header',
      gameState: {
        timer: state.started ? Math.max(0, state.timer - (Date.now() - state.last_press_time) / 1000) : 60,
        pot: state.pot,
        round: state.current_round,
        lastPresser: state.last_presser,
        gameOver: state.game_over
      }
    }, 402);
  }

  // Parse body after 402 check
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const player = body.player?.slice(0, 42) || 'Anonymous';

  const state = await getCurrentGameState(c.env.DB);
  
  if (state.game_over) {
    return c.json({ success: false, error: 'Game over! Start a new round.' }, 400);
  }

  let currentTimer = 60;
  if (state.started) {
    const elapsed = (Date.now() - state.last_press_time) / 1000;
    currentTimer = Math.max(0, state.timer - elapsed);
    
    if (currentTimer <= 0) {
      await endGame(c.env.DB);
      return c.json({ success: false, error: 'Too late! Game over.' }, 400);
    }
  }

  // Verify and broadcast the payment
  try {
    const txRes = await fetch('https://api.hiro.so/v2/transactions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/hex',
        'User-Agent': 'the-button/1.0'
      },
      body: payment
    });

    if (!txRes.ok) {
      const err = await txRes.text();
      console.error('Payment broadcast failed:', err);
      return c.json({ success: false, error: 'Payment failed: ' + err }, 400);
    }

    const txData = await txRes.json() as any;
    const txId = txData.txid;

    // Get current round
    const round = await c.env.DB.prepare('SELECT id FROM game_rounds WHERE round_number = ?').bind(state.current_round).first();
    
    // Ensure player exists
    await upsertPlayer(c.env.DB, player, body.walletAddress);
    
    // Record the press with payment info
    const paymentSats = PRESS_COST_SATS / 100000000; // Convert to sBTC
    const { color, flair } = await recordPress(c.env.DB, round.id, player, currentTimer, txId, paymentSats);
    
    // Get updated state
    const newState = await getCurrentGameState(c.env.DB);

    return c.json({ 
      success: true,
      timer: 60,
      color,
      flair,
      txId,
      mode: 'sbtc',
      pot: newState.pot,
      pressCount: newState.press_count,
      round: newState.current_round
    });

  } catch (err) {
    console.error('Payment verification error:', err);
    return c.json({ success: false, error: 'Payment verification failed' }, 400);
  }
});

// Reset for new round
app.post('/api/reset', async (c) => {
  await startNewRound(c.env.DB);
  const newState = await getCurrentGameState(c.env.DB);
  return c.json({ success: true, round: newState.current_round });
});

// Enhanced API for AI agents
app.get('/api/agent', async (c) => {
  const state = await getCurrentGameState(c.env.DB);
  const leaderboard = await getLeaderboard(c.env.DB);
  const recentPresses = await getRecentPresses(c.env.DB, 10);
  
  let currentTimer = 60;
  if (state.started) {
    const elapsed = (Date.now() - state.last_press_time) / 1000;
    currentTimer = Math.max(0, state.timer - elapsed);
  }

  return c.json({
    description: 'The Button - Press to reset the timer. When it hits 0, last presser wins the pot.',
    timer: currentTimer,
    pot: state.pot,
    lastPresser: state.last_presser,
    pressCount: state.press_count,
    round: state.current_round,
    gameOver: state.game_over,
    leaderboard: leaderboard.slice(0, 10),
    recentPresses: recentPresses.slice(0, 5),
    actions: {
      pressFree: {
        method: 'POST',
        endpoint: '/api/press',
        body: { player: 'your-identifier' },
        cost: '0.001 sBTC equivalent (simulated)'
      },
      pressPaid: {
        method: 'POST',
        endpoint: '/api/press-sbtc',
        headers: { 'X-PAYMENT': 'signed-transaction-hex' },
        body: { player: 'your-identifier' },
        cost: '1000 sats real sBTC'
      }
    },
    strategy_hints: [
      'Press early to reset and be safe',
      'Press late for better flair colors and bragging rights', 
      'Watch the timer - if no one presses, you win the pot',
      'Check the leaderboard to see top players',
      'Consider the risk vs reward based on current pot size'
    ],
    flairSystem: {
      'Purple (Early Bird)': '> 50s remaining',
      'Blue (Cautious)': '40-50s remaining', 
      'Green (Moderate)': '30-40s remaining',
      'Yellow (Risk Taker)': '20-30s remaining',
      'Orange (Daredevil)': '10-20s remaining',
      'Red (Madlad)': '< 10s remaining'
    }
  });
});

app.get('/health', async (c) => {
  const state = await getCurrentGameState(c.env.DB);
  return c.json({ 
    status: 'button ready', 
    round: state.current_round,
    dbConnected: true,
    gameOver: state.game_over
  });
});

// x402 well-known discovery
app.get('/.well-known/x402.json', (c) => {
  return c.json({
    x402Version: 1,
    name: 'The Button',
    description: 'Press to reset the timer. When it hits 0, last presser wins the pot.',
    endpoints: [{
      path: '/api/press-sbtc',
      method: 'POST',
      asset: 'sBTC',
      amount: PRESS_COST_SATS,
      description: 'Press The Button with real sBTC'
    }]
  });
});

export default app;