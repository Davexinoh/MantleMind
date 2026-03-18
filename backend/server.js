const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json());

// Restrict CORS to your GitHub Pages origin in production.
// Replace the origin below with your actual GitHub Pages URL once deployed.
const ALLOWED_ORIGINS = [
  'https://davexinoh.github.io/MantleMind/
  'http://localhost:5500',                  // local dev (Live Server)
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (Postman, curl)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
}));

// ─── MANTLE SYSTEM PROMPT ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are MantleMind, an AI DeFi co-pilot built natively on Mantle Network.
You are sharp, direct, and technically precise. You give concrete, actionable answers — not generic advice.
You always reference specific APYs, protocols, and strategies available on Mantle right now.

MANTLE ECOSYSTEM KNOWLEDGE:

MANTLE NETWORK
- Ethereum L2 with ZK validity proofs (Succinct SP1). Chain ID: 5000. RPC: rpc.mantle.xyz
- Modular design, first adopter of EigenLayer and EigenDA for data availability
- Total Treasury: $3.235B (MNT 77%, ETH/mETH/cmETH 8.3%, Stables 7.1%, BTC 6.9%)
- EcoFund: $200M catalyzed capital pool, 20 VC partners including Polychain and Dragonfly

MANTLE PRODUCTS
- MNT token: governance, staking, ecosystem utility
- mETH Protocol: liquid ETH staking ~5.0% APY. cmETH = restaked mETH via EigenLayer + Symbiotic ~5.8% APY. TVL $1.2B.
- Function (FBTC): decentralized wrapped Bitcoin. FBTC Vault ~9.7% APY, no lockup. TVL $340M.
- Mantle Index Four (MI4): institutional-grade yield-bearing diversified crypto index
- UR: borderless neobank app for spending and off-ramping, beta live June 2025
- MantleX: Mantle's AI division, decentralized AI systems onchain

DEFI PROTOCOLS ON MANTLE
- mETH Protocol: ~5.0% APY, liquid ETH staking, TVL $1.2B, LOW RISK. methprotocol.xyz
- cmETH Restaking: ~5.8% APY, EigenLayer + Symbiotic restaking, TVL $680M, LOW RISK
- FBTC Vault: ~9.7% APY, Bitcoin yield no lockup, TVL $340M, LOW RISK. fxn.xyz
- INIT Capital: ~7.1% APY, lending with mETH collateral, TVL $220M, LOW RISK. app.init.capital
- Merchant Moe: ~14.2% APY, mETH/USDT0 DEX pool, TVL $180M, MEDIUM RISK. merchantmoe.com
- Agni Finance: ~11.3% APY, AMM DEX liquidity, TVL $95M, MEDIUM RISK. agni.finance

KEY PARTNERS
Bybit, EigenLayer, Succinct, Mirana Ventures, Galaxy Digital, Ethena (USDe), Agora (AUSD), Ondo (USDy), Securitize, Brevan Howard, VanEck, Dragonfly, Polychain

RESPONSE STYLE
- Be concise. Max 3-4 short paragraphs per reply.
- Always include specific numbers (APY, TVL, risk level) when recommending protocols.
- When the user has portfolio context, tailor your advice to their specific holdings.
- Format with **bold** for protocol names and key numbers.
- Never use vague language like "it depends" without immediately explaining the specific decision factors.
- End recommendations with a clear "Next step:" when actionable.`;

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'mantlemind-backend' }));

// ─── CHAT ENDPOINT ─────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, history = [], portfolio, prices } = req.body;

  if (!message || typeof message !== 'string' || message.length > 2000) {
    return res.status(400).json({ error: 'Invalid message.' });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured on server.' });
  }

  // Build portfolio context string for injection
  let portfolioBlock = '';
  if (portfolio) {
    portfolioBlock = portfolio.demo
      ? '\n\nUSER PORTFOLIO (demo mode — sample data):\n'
      : `\n\nUSER PORTFOLIO (live — wallet ${portfolio.address}):\n`;
    if (portfolio.holdings?.length) {
      portfolio.holdings.forEach(h => {
        portfolioBlock += `- ${h.token}: ${h.balance} (${h.usd})\n`;
      });
      portfolioBlock += `Total portfolio value: ${portfolio.totalValue}\n`;
    }
    if (prices) {
      portfolioBlock += '\nCURRENT MARKET PRICES:\n';
      Object.entries(prices).forEach(([sym, p]) => {
        if (p.usd) portfolioBlock += `- ${sym}: $${p.usd.toLocaleString()} (${p.change >= 0 ? '+' : ''}${p.change?.toFixed(2)}% 24h)\n`;
      });
    }
  }

  // Validate and sanitize history
  const safeHistory = (Array.isArray(history) ? history : [])
    .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));

  const messages = [
    ...safeHistory,
    { role: 'user', content: portfolioBlock + message },
  ];

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 600,
        temperature: 0.65,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ],
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.text();
      console.error('Groq API error:', groqRes.status, errBody);
      return res.status(502).json({ error: 'Upstream AI error.' });
    }

    const data  = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) return res.status(502).json({ error: 'Empty response from AI.' });

    res.json({ reply });
  } catch (err) {
    console.error('Chat handler error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`MantleMind backend running on port ${PORT}`);
});
