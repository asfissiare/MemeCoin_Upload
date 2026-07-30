import mongoose from 'mongoose';

const livePositionSchema = new mongoose.Schema({
  mint: String,
  symbol: String,
  buyPriceSol: Number,
  tokenAmount: Number,
  candidateStats: mongoose.Schema.Types.Mixed,
  openedAt: String,
  latestPnlPercent: Number,
  lastUpdated: String
});

const userSchema = new mongoose.Schema({
  discordUserId: { type: String, required: true, unique: true },
  publicKey: String,
  encryptedPrivateKey: String,
  dashboardAuthToken: String,
  autoTradeEnabled: Boolean,
  maxSolPerTrade: Number,
  maxSolPerDay: Number,
  slippageBps: Number,
  spentTodaySol: Number,
  lastResetUtc: String,
  registeredAt: String,
  livePositions: [livePositionSchema]
});

const paperPositionSchema = new mongoose.Schema({
  id: String,
  mint: String,
  symbol: String,
  name: String,
  solInvested: Number,
  entryPriceUsd: Number,
  tokensReceived: Number,
  openedAt: String,
  status: String,
  closedAt: String,
  exitPriceUsd: Number,
  returnSol: Number,
  pnlPercent: Number,
  pnlSol: Number,
  exitReason: String
});

const portfolioSchema = new mongoose.Schema({
  discordUserId: { type: String, required: true, unique: true },
  trialEnabled: Boolean,
  trialStartedAt: Number,
  reminderSentAt: Number,
  paperSolBalance: Number,
  positions: [paperPositionSchema]
});

const trainingDataSchema = new mongoose.Schema({
  type: { type: String, enum: ['BUY', 'SELL'] },
  symbol: String,
  pnlPercent: Number,
  originalStats: mongoose.Schema.Types.Mixed,
  lowQuality: Boolean
});

const modelWeightsSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  weights: mongoose.Schema.Types.Mixed
});

export const User = mongoose.model('User', userSchema);
export const Portfolio = mongoose.model('Portfolio', portfolioSchema);
export const TrainingData = mongoose.model('TrainingData', trainingDataSchema);
export const ModelWeights = mongoose.model('ModelWeights', modelWeightsSchema);
