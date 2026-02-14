# The Button - Enhanced Edition

A global countdown game where players press a button to reset a 60-second timer. When the timer reaches zero, the last person to press wins the entire pot! Now with persistent storage, leaderboards, and enhanced x402 integration.

## 🚀 New Features Added

### 1. **Persistent Storage with Cloudflare D1**
- Game state survives server restarts
- All player data and press history stored permanently
- Multi-round support with round tracking

### 2. **Global Leaderboard**
- All-time player statistics (presses, winnings, profit/loss)
- ROI calculations for each player
- Persistent across multiple game rounds

### 3. **Enhanced UI**
- Tabbed interface (Game, Leaderboard, History)
- Round tracking and total games counter
- Real-time leaderboard updates
- Improved visual design with profit/loss indicators

### 4. **Better x402 Integration**
- Improved error handling for sBTC payments
- Enhanced payment verification
- Better API responses with game context
- More detailed x402 discovery endpoints

### 5. **Comprehensive API for AI Agents**
- Enhanced `/api/agent` endpoint with strategy hints
- Leaderboard data access
- Recent press history
- Flair system documentation

## 🛠️ Setup Instructions

### Prerequisites
- [Bun](https://bun.sh) runtime
- [Wrangler](https://developers.cloudflare.com/workers/cli-commands/wrangler/install) CLI
- Cloudflare account with Workers and D1 enabled

### 1. Install Dependencies
```bash
bun install
```

### 2. Create D1 Database
```bash
# Create the database
wrangler d1 create the-button-db

# Copy the database_id from the output and update wrangler.toml
# Replace "your-database-id-here" with the actual ID

# Initialize the database schema
wrangler d1 execute the-button-db --file=./schema.sql
```

### 3. Configure Environment
Update `wrangler.toml` with your database ID and treasury address:
```toml
[[d1_databases]]
binding = "DB"
database_name = "the-button-db"
database_id = "your-actual-database-id"

[vars]
TREASURY_ADDRESS = "your-stacks-address-here"
```

### 4. Development
```bash
# Run locally with D1 local database
wrangler dev --local

# Or run with remote D1 (requires deployment first)
wrangler dev
```

### 5. Deploy
```bash
# Deploy to Cloudflare Workers
wrangler deploy
```

## 🎮 How to Play

### Free Mode
1. Enter your name/identifier
2. Click the **PRESS** button to reset the timer
3. Timer resets to 60 seconds
4. When timer hits 0, last presser wins the pot!

### sBTC Mode (Real Bitcoin)
Use the x402 endpoint `/api/press-sbtc` with 1000 sats sBTC payment to press with real money.

## 🏆 Flair System

Players earn colored flair based on when they press:
- **Purple (Early Bird)**: > 50 seconds remaining
- **Blue (Cautious)**: 40-50 seconds
- **Green (Moderate)**: 30-40 seconds  
- **Yellow (Risk Taker)**: 20-30 seconds
- **Orange (Daredevil)**: 10-20 seconds
- **Red (Madlad)**: < 10 seconds

## 🤖 AI Agent Integration

### Game State API
```bash
GET /api/agent
```
Returns current game state, leaderboard, recent presses, and strategy hints.

### Press Actions
```bash
# Free mode press
POST /api/press
{"player": "your-name"}

# sBTC mode press (requires x402 payment)
POST /api/press-sbtc
X-PAYMENT: signed-transaction-hex
{"player": "your-name"}
```

## 📊 Database Schema

The D1 database includes:
- `game_rounds`: Track each game round with winners and totals
- `players`: Persistent player statistics and profiles
- `presses`: Every button press with timestamp and context
- `game_state`: Current game state (single row)

## 🔗 x402 Integration

The enhanced x402 integration includes:
- Proper discovery endpoints (`/.well-known/x402.json`)
- Enhanced payment verification
- Better error handling with specific error codes
- Game context in 402 responses

## 🚀 Deployment Architecture

```
Cloudflare Workers + D1 Database
├── Frontend: Static HTML/CSS/JS served from Worker
├── Backend: Hono.js API with game logic  
├── Database: Cloudflare D1 for persistence
└── Payments: x402 + sBTC integration
```

## 📝 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Game frontend |
| `/api/state` | GET | Current game state |
| `/api/leaderboard` | GET | All-time leaderboard |
| `/api/history` | GET | Recent press history |
| `/api/press` | POST | Free mode press |
| `/api/press-sbtc` | GET/POST | x402 sBTC press |
| `/api/reset` | POST | Start new round |
| `/api/agent` | GET | AI agent integration |
| `/health` | GET | Health check |

## 🔧 Technical Improvements

1. **Database-First Architecture**: All game logic now persists to D1
2. **Proper Error Handling**: Comprehensive error responses and validation
3. **Performance Optimizations**: Efficient queries with proper indexing
4. **Enhanced Security**: Input validation and SQL injection prevention
5. **Scalability**: Database design supports unlimited players and rounds

## 🎯 Future Improvements

Potential enhancements for future versions:
- WebSocket support for real-time updates
- Advanced statistics and analytics dashboard
- Tournament mode with bracket systems
- NFT rewards for winners
- Multi-language support
- Mobile app integration

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly with D1 local database
5. Submit a pull request with detailed description

## 📄 License

MIT License - Feel free to fork and build upon this project!

---

**Original Repository**: [pbtc21/the-button](https://github.com/pbtc21/the-button)  
**Enhanced by**: Secret Mars (AI Agent)  
**Built with**: Bun, Hono, Cloudflare Workers, D1 Database, x402 Protocol