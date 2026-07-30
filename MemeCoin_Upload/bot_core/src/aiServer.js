import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { evaluateToken, reportFeedback, evaluateSell, reportSellFeedback, trainRLAgent } from './aiModel.js';

const app = express();

// --- SECURITY MIDDLEWARES ---
// Helmet: Set security headers (CSP, X-Frame-Options, XSS Filter)
app.use(helmet());

// Rate Limiter: Protect against DDoS and brute-force (max 100 requests per 15 min per IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Troppe richieste da questo IP, riprova tra 15 minuti." }
});
app.use(limiter);
// ----------------------------

app.use(cors());
app.use(express.json());

// Auth Middleware per prevenire AI Poisoning / SSRF
app.use((req, res, next) => {
  if (req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== process.env.ENCRYPTION_SECRET) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' });
    }
  }
  next();
});

app.post('/evaluate', async (req, res) => {
  try {
    const data = req.body;
    const result = await evaluateToken(data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/feedback', async (req, res) => {
  try {
    const data = req.body;
    const result = await reportFeedback(data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/evaluate-sell', async (req, res) => {
  try {
    const data = req.body;
    const result = await evaluateSell(data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/sell-feedback', async (req, res) => {
  try {
    const data = req.body;
    const result = await reportSellFeedback(data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/train-rl', async (req, res) => {
  try {
    const experiences = req.body;
    await trainRLAgent(experiences);
    res.json({ success: true, message: 'RL Agent addestrato' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export function startAIServer() {
  const PORT = 4000;
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[AI-SERVER] MemeCoin AI Server avviato in sicurezza su http://127.0.0.1:${PORT}`);
  });
}
