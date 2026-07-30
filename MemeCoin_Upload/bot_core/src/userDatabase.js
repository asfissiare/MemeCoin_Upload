import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { User } from './db/models.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'master.key');

function getEncryptionKey() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const secretHex = process.env.ENCRYPTION_SECRET;
  if (!secretHex) {
    throw new Error("CRITICO: ENCRYPTION_SECRET non configurato nel file .env! L'applicazione rifiuta l'avvio per ragioni di sicurezza.");
  }

  return crypto.scryptSync(secretHex, 'solana-bot-salt-v1', 32);
}

function encrypt(text, masterKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(cipherText, masterKey) {
  const parts = cipherText.split(':');
  if (parts.length !== 3) throw new Error('Formato cifrato non valido');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export class UserDatabase {
  constructor() {
    this.masterKey = getEncryptionKey();
    this.users = new Map();
    this.useMongo = false;
  }

  async init() {
    if (process.env.MONGODB_URI) {
      this.useMongo = true;
      try {
        const dbUsers = await User.find({});
        for (const u of dbUsers) {
          this.users.set(u.discordUserId, u.toObject());
        }
        console.log(`[DATABASE] Caricati ${dbUsers.length} utenti da MongoDB`);
      } catch (err) {
        console.error('[DATABASE] Errore caricamento da MongoDB:', err.message);
      }
    } else {
      this.useMongo = false;
      this.loadLocal();
    }
  }

  loadLocal() {
    if (!fs.existsSync(DB_FILE)) return;
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const user of data) {
          this.users.set(user.discordUserId, user);
        }
      }
    } catch (err) {
      console.error('[DATABASE] Errore nel caricamento del database utenti:', err.message);
    }
  }

  save() {
    if (this.useMongo) {
      const arr = Array.from(this.users.values());
      for (const u of arr) {
        User.findOneAndUpdate({ discordUserId: u.discordUserId }, u, { upsert: true })
            .catch(err => console.error('[DATABASE] Errore salvataggio MongoDB:', err.message));
      }
    } else {
      try {
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        const data = Array.from(this.users.values());
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
      } catch (err) {
        console.error('[DATABASE] Errore durante il salvataggio del database:', err.message);
      }
    }
  }

  parseKeypair(privateKeyStr) {
    const trimmed = privateKeyStr.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const arr = JSON.parse(trimmed);
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } else {
      return Keypair.fromSecretKey(bs58.decode(trimmed));
    }
  }

  registerUserWallet(discordUserId, privateKeyStr, maxSolPerTrade = 0.05, maxSolPerDay = 0.20) {
    let keypair;
    try {
      keypair = this.parseKeypair(privateKeyStr);
    } catch (err) {
      throw new Error('Chiave privata non valida. Assicurati che sia in formato Base58 o JSON array.');
    }

    const publicKey = keypair.publicKey.toBase58();
    const encryptedKey = encrypt(privateKeyStr.trim(), this.masterKey);

    const todayUtc = new Date().toISOString().split('T')[0];
    const dashboardAuthToken = crypto.randomBytes(32).toString('hex'); // Generate secure token

    const userData = {
      discordUserId,
      publicKey,
      encryptedPrivateKey: encryptedKey,
      dashboardAuthToken,
      autoTradeEnabled: true,
      maxSolPerTrade: Number(maxSolPerTrade) || 0.05,
      maxSolPerDay: Number(maxSolPerDay) || 0.20,
      slippageBps: 150,
      spentTodaySol: 0,
      lastResetUtc: todayUtc,
      registeredAt: new Date().toISOString(),
      livePositions: []
    };

    this.users.set(discordUserId, userData);
    this.save();

    return { publicKey, maxSolPerTrade: userData.maxSolPerTrade, maxSolPerDay: userData.maxSolPerDay };
  }

  // Helper to ensure backwards compatibility for users without a token
  ensureAuthToken(user) {
    if (!user.dashboardAuthToken) {
      user.dashboardAuthToken = crypto.randomBytes(32).toString('hex');
      this.save();
    }
  }

  getUserInfo(discordUserId) {
    const user = this.users.get(discordUserId);
    if (!user) return null;

    this.checkDailyReset(user);
    this.ensureAuthToken(user);

    return {
      discordUserId: user.discordUserId,
      publicKey: user.publicKey,
      autoTradeEnabled: user.autoTradeEnabled,
      maxSolPerTrade: user.maxSolPerTrade,
      maxSolPerDay: user.maxSolPerDay,
      slippageBps: user.slippageBps,
      spentTodaySol: user.spentTodaySol,
      remainingTodaySol: Math.max(0, user.maxSolPerDay - user.spentTodaySol),
      livePositions: user.livePositions,
      dashboardAuthToken: user.dashboardAuthToken
    };
  }

  removeUser(discordUserId) {
    if (this.users.has(discordUserId)) {
      this.users.delete(discordUserId);
      this.save();
      return true;
    }
    return false;
  }

  exportPrivateKey(discordUserId) {
    const user = this.users.get(discordUserId);
    if (!user) return null;
    return decrypt(user.encryptedPrivateKey, this.masterKey);
  }

  getUserKeypair(discordUserId) {
    const user = this.users.get(discordUserId);
    if (!user) return null;
    try {
      const rawKey = decrypt(user.encryptedPrivateKey, this.masterKey);
      return this.parseKeypair(rawKey);
    } catch (err) {
      console.error(`[DATABASE] Impossibile decifrare chiave per utente ${discordUserId}:`, err.message);
      return null;
    }
  }

  getAllAutoTradeUsers() {
    const todayUtc = new Date().toISOString().split('T')[0];
    const result = [];

    for (const user of this.users.values()) {
      if (!user.autoTradeEnabled) continue;

      this.checkDailyReset(user);

      try {
        const keypair = this.getUserKeypair(user.discordUserId);
        if (keypair) {
          result.push({
            user,
            keypair,
            remainingSol: Math.max(0, user.maxSolPerDay - user.spentTodaySol)
          });
        }
      } catch (err) {
        // Skip un-decryptable users
      }
    }
    return result;
  }

  recordUserSpend(discordUserId, amountSol) {
    const user = this.users.get(discordUserId);
    if (!user) return;

    this.checkDailyReset(user);
    user.spentTodaySol = Number((user.spentTodaySol + amountSol).toFixed(6));
    this.save();
  }

  updateUserSettings(discordUserId, settings) {
    const user = this.users.get(discordUserId);
    if (!user) throw new Error('Nessun wallet registrato per questo utente.');

    if (typeof settings.autoTradeEnabled === 'boolean') {
      user.autoTradeEnabled = settings.autoTradeEnabled;
    }
    if (typeof settings.maxSolPerTrade === 'number' && settings.maxSolPerTrade > 0) {
      user.maxSolPerTrade = settings.maxSolPerTrade;
    }
    if (typeof settings.maxSolPerDay === 'number' && settings.maxSolPerDay > 0) {
      user.maxSolPerDay = settings.maxSolPerDay;
    }
    if (typeof settings.slippageBps === 'number' && settings.slippageBps > 0) {
      user.slippageBps = settings.slippageBps;
    }

    this.save();
    return this.getUserInfo(discordUserId);
  }

  removeUserWallet(discordUserId) {
    const deleted = this.users.delete(discordUserId);
    if (deleted) this.save();
    return deleted;
  }

  addLivePosition(discordUserId, mint, buyPriceSol, tokenAmount, symbol, candidateStats = null) {
    const user = this.users.get(discordUserId);
    if (!user) return;
    
    if (!user.livePositions) {
      user.livePositions = [];
    }
    
    user.livePositions.push({
      mint,
      buyPriceSol,
      tokenAmount,
      symbol,
      boughtAt: new Date().toISOString(),
      timestamp: Date.now(),
      candidateStats: candidateStats || null
    });
    
    this.save();
  }

  removeLivePosition(discordUserId, mint) {
    const user = this.users.get(discordUserId);
    if (!user || !user.livePositions) return;
    
    user.livePositions = user.livePositions.filter(p => p.mint !== mint);
    this.save();
  }

  checkDailyReset(user) {
    const todayUtc = new Date().toISOString().split('T')[0];
    if (user.lastResetUtc !== todayUtc) {
      user.spentTodaySol = 0;
      user.lastResetUtc = todayUtc;
      this.save();
    }
  }
}

export const userDatabase = new UserDatabase();
