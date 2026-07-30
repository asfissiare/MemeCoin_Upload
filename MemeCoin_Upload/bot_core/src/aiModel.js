import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TrainingData, ModelWeights } from './db/models.js';
let useMongo = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../data/training_data.json');
const SELL_DATA_FILE = path.join(__dirname, '../data/sell_training_data.json');
const BUY_MODEL_WEIGHTS = path.join(__dirname, '../ai_training_results/latest_model_weights.json');
const SELL_MODEL_WEIGHTS = path.join(__dirname, '../ai_training_results/latest_sell_model_weights.json');

// --- Helper Math & NN Functions ---

function randomNormal() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); // Converting [0,1) to (0,1)
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function leakyRelu(x) {
    return x > 0 ? x : 0.01 * x;
}

function leakyReluDeriv(x) {
    return x > 0 ? 1 : 0.01;
}

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function sigmoidDeriv(x) {
    const s = sigmoid(x);
    return s * (1 - s);
}

function clip(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

class NeuralNetwork {
    constructor(architecture, options = {}) {
        this.architecture = architecture;
        this.options = {
            outputActivation: options.outputActivation || 'sigmoid',
            lossFunction: options.lossFunction || 'bce'
        };
        this.layers = [];
        this.adamParams = [];
        this.t = 0;
        
        for (let i = 1; i < architecture.length; i++) {
            const inputSize = architecture[i-1];
            const outputSize = architecture[i];
            
            const weights = Array.from({length: outputSize}, () => 
                Array.from({length: inputSize}, () => Math.sqrt(2 / inputSize) * randomNormal())
            );
            const biases = Array.from({length: outputSize}, () => 0.0);
            
            this.layers.push({ weights, biases, activation: i === architecture.length - 1 ? this.options.outputActivation : 'leakyRelu' });
            
            this.adamParams.push({
                mW: Array.from({length: outputSize}, () => Array(inputSize).fill(0)),
                vW: Array.from({length: outputSize}, () => Array(inputSize).fill(0)),
                mB: Array(outputSize).fill(0),
                vB: Array(outputSize).fill(0)
            });
        }
    }

    getState() {
        return { layers: this.layers };
    }

    loadState(state) {
        if (state && state.layers) {
            this.layers = state.layers;
        }
    }

    forward(inputs, isTraining = false) {
        let activations = [inputs];
        let preActivations = [];
        let dropoutMasks = [];
        let currentActivation = inputs;

        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            let z = [];
            let a = [];
            let mask = [];
            const isOutputLayer = i === this.layers.length - 1;
            
            for (let j = 0; j < layer.biases.length; j++) {
                let sum = layer.biases[j];
                for (let k = 0; k < currentActivation.length; k++) {
                    sum += layer.weights[j][k] * currentActivation[k];
                }
                z.push(sum);
                
                let act = layer.activation === 'sigmoid' ? sigmoid(sum) : (layer.activation === 'linear' ? sum : leakyRelu(sum));
                
                let keep = 1.0;
                if (isTraining && !isOutputLayer) {
                    keep = Math.random() > 0.2 ? 1 : 0;
                    act = (act * keep) / 0.8;
                }
                a.push(act);
                mask.push(keep);
            }
            preActivations.push(z);
            activations.push(a);
            dropoutMasks.push(mask);
            currentActivation = a;
        }

        return { activations, preActivations, dropoutMasks };
    }

    trainBatch(batch, lr = 0.001, beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8, l2 = 0.0001, classWeights = null) {
        this.t++;
        
        // Initialize gradient accumulators
        let gradW = this.layers.map(layer => layer.weights.map(row => row.map(() => 0)));
        let gradB = this.layers.map(layer => layer.biases.map(() => 0));
        let batchLoss = 0;

        // Accumulate gradients
        for (const { inputs, target } of batch) {
            const { activations, preActivations, dropoutMasks } = this.forward(inputs, true);
            const output = activations[activations.length - 1];
            
                        let delta = [];
            let outputDelta = [];
            
            if (this.options.lossFunction === 'mse') {
                let sumSqError = 0;
                for (let j = 0; j < output.length; j++) {
                    const err = output[j] - target[j];
                    sumSqError += err * err;
                    outputDelta.push(err);
                }
                batchLoss += sumSqError / output.length;
                delta.push(outputDelta);
            } else {
                const outVal = output[0] !== undefined ? output[0] : output;
                const tgtVal = Array.isArray(target) ? target[0] : target;
                const epsilonLoss = 1e-15;
                const clippedOutput = clip(outVal, epsilonLoss, 1 - epsilonLoss);
                
                let weight = 1.0;
                if (classWeights) {
                    // Assume tgtVal is roughly 0 or 1.
                    const isWin = tgtVal >= 0.5;
                    weight = isWin ? (classWeights[1] || 1.0) : (classWeights[0] || 1.0);
                }
                
                batchLoss += -weight * (tgtVal * Math.log(clippedOutput) + (1 - tgtVal) * Math.log(1 - clippedOutput));
                delta.push([weight * (outVal - tgtVal)]);
            }

            for (let i = this.layers.length - 1; i >= 0; i--) {
                const layer = this.layers[i];
                const currentDelta = delta[delta.length - 1];
                const prevActivation = activations[i];

                for (let j = 0; j < layer.biases.length; j++) {
                    gradB[i][j] += currentDelta[j];
                    for (let k = 0; k < prevActivation.length; k++) {
                        gradW[i][j][k] += currentDelta[j] * prevActivation[k];
                    }
                }

                if (i > 0) {
                    const prevLayerDelta = [];
                    for (let k = 0; k < prevActivation.length; k++) {
                        let sum = 0;
                        for (let j = 0; j < layer.biases.length; j++) {
                            sum += layer.weights[j][k] * currentDelta[j];
                        }
                        sum *= leakyReluDeriv(preActivations[i-1][k]);
                        
                        const mask = dropoutMasks[i-1][k];
                        sum = (sum * mask) / 0.8;
                        
                        prevLayerDelta.push(sum);
                    }
                    delta.push(prevLayerDelta);
                }
            }
        }

        // Apply Adam optimizer
        const m = batch.length;
        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            const adam = this.adamParams[i];

            for (let j = 0; j < layer.biases.length; j++) {
                // Bias update
                let gb = gradB[i][j] / m;
                gb = clip(gb, -1, 1); // Gradient clipping

                adam.mB[j] = beta1 * adam.mB[j] + (1 - beta1) * gb;
                adam.vB[j] = beta2 * adam.vB[j] + (1 - beta2) * (gb * gb);
                
                const mB_hat = adam.mB[j] / (1 - Math.pow(beta1, this.t));
                const vB_hat = adam.vB[j] / (1 - Math.pow(beta2, this.t));

                layer.biases[j] -= lr * mB_hat / (Math.sqrt(vB_hat) + epsilon);

                // Weight update
                for (let k = 0; k < layer.weights[j].length; k++) {
                    let gw = gradW[i][j][k] / m;
                    gw = clip(gw, -1, 1); // Gradient clipping
                    gw += l2 * layer.weights[j][k]; // L2 Weight decay

                    adam.mW[j][k] = beta1 * adam.mW[j][k] + (1 - beta1) * gw;
                    adam.vW[j][k] = beta2 * adam.vW[j][k] + (1 - beta2) * (gw * gw);
                    
                    const mW_hat = adam.mW[j][k] / (1 - Math.pow(beta1, this.t));
                    const vW_hat = adam.vW[j][k] / (1 - Math.pow(beta2, this.t));

                    layer.weights[j][k] -= lr * mW_hat / (Math.sqrt(vW_hat) + epsilon);
                }
            }
        }

        return batchLoss / m;
    }
}

// --- Initialize Models ---

const buyModel = new NeuralNetwork([24, 128, 64, 32, 16, 1]);
const sellModel = new NeuralNetwork([7, 16, 16, 2], { outputActivation: 'linear', lossFunction: 'mse' });

// --- Data Loading & Initialization ---

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function loadModelWeights(model, filePath, modelName) {
    if (useMongo && modelName) {
        try {
            const doc = await ModelWeights.findOne({ name: modelName });
            if (doc && doc.weights) {
                model.loadState(doc.weights);
                return true;
            }
        } catch(e) { console.error('[AI-MODEL] Errore caricamento pesi da MongoDB', e); }
        return false;
    }
    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            model.loadState(data);
            return true;
        } catch (e) {
            console.error(`[AI-MODEL] Errore nel caricamento pesi da ${filePath}`, e);
        }
    }
    return false;
}

async function saveModelWeights(model, filePath, modelName) {
    if (useMongo && modelName) {
        try {
            await ModelWeights.findOneAndUpdate({ name: modelName }, { name: modelName, weights: model.getState() }, { upsert: true });
        } catch(e) { console.error('[AI-MODEL] Errore salvataggio pesi MongoDB', e); }
    } else {
        ensureDir(filePath);
        fs.writeFileSync(filePath, JSON.stringify(model.getState(), null, 2));
    }
}

let buyTrainingData = [];
let sellTrainingData = [];

export async function initAIModel() {
    if (process.env.MONGODB_URI) {
        useMongo = true;
        try {
            buyTrainingData = await TrainingData.find({ type: 'BUY' });
            sellTrainingData = await TrainingData.find({ type: 'SELL' });
        } catch(e) { console.error('[AI-MODEL] Errore db', e); }
    } else {
        useMongo = false;
        if (fs.existsSync(DATA_FILE)) {
            try {
                let data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                buyTrainingData = data;
            } catch (e) {}
        }
        if (fs.existsSync(SELL_DATA_FILE)) {
            try {
                sellTrainingData = JSON.parse(fs.readFileSync(SELL_DATA_FILE, 'utf8'));
            } catch (e) {}
        }
    }

    const buyLoaded = await loadModelWeights(buyModel, BUY_MODEL_WEIGHTS, 'BUY_MODEL');
    if (!buyLoaded) {
        console.log('[AI-MODEL] Pesi del Buy Model non trovati. Addestramento iniziale...');
        if (buyTrainingData.length > 0) {
            const extractFeatures = (d) => {
                const stats = d.originalStats || d.input || {};
                return getBuyFeatures(stats);
            };
            trainModel(buyModel, buyTrainingData, extractFeatures,
                d => getBuyTarget(d.pnlPercent || (d.output ? (d.output.score > 0.5 ? 20 : -20) : 0)),
                BUY_MODEL_WEIGHTS, "BUY_MODEL"
            );
        }
    } else {
        console.log(`[AI-MODEL] Buy Model caricato con successo (${buyTrainingData.length} campioni nel dataset).`);
    }

    const sellLoaded = await loadModelWeights(sellModel, SELL_MODEL_WEIGHTS, 'SELL_MODEL');
    if (!sellLoaded) {
        console.log('[AI-MODEL] Pesi del Sell Model non trovati.');
    } else {
        console.log(`[AI-MODEL] Sell Model caricato con successo (${sellTrainingData.length} campioni nel dataset).`);
    }
}

// --- Training Loop ---

function trainModel(model, dataset, extractFeatures, extractTarget, weightsFile, modelName) {
    const validData = dataset.filter(d => !d.lowQuality);
    const totalData = dataset.length;
    const skippedData = totalData - validData.length;

    console.log(`[AI-MODEL] Training ${modelName} su ${validData.length} campioni di qualità (${totalData} totali, ${skippedData} saltati)...`);
    
    if (validData.length === 0) {
        console.log(`[AI-MODEL] Dati insufficienti per addestrare ${modelName}.`);
        return;
    }

    const parsedData = validData.map(d => ({
        inputs: extractFeatures(d),
        target: extractTarget(d)
    }));

    const maxEpochs = 500;
    const batchSize = 16;
    let bestLoss = Infinity;
    let epochsWithoutImprovement = 0;
    let finalAccuracy = 0;

    // Calculate class weights for Buy Model (binary classification)
    let classWeights = null;
    if (modelName === "BUY_MODEL") {
        let wins = 0;
        let losses = 0;
        for (const item of parsedData) {
            if (item.target >= 0.5) wins++;
            else losses++;
        }
        if (wins > 0 && losses > 0) {
            const total = wins + losses;
            classWeights = {
                0: total / (2 * losses),
                1: Math.min(50, total / (2 * wins)) // Cap weight at 50x to prevent explosion
            };
        } else if (wins === 0 && losses > 0) {
            classWeights = { 0: 1, 1: 50 }; // Hardcoded fallback if no wins
        }
        console.log(`[AI-MODEL] Class Weights calcolati: Loss=${classWeights ? classWeights[0].toFixed(2) : 1}, Win=${classWeights ? classWeights[1].toFixed(2) : 1}`);
    }

    for (let epoch = 1; epoch <= maxEpochs; epoch++) {
        // Shuffle
        for (let i = parsedData.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [parsedData[i], parsedData[j]] = [parsedData[j], parsedData[i]];
        }

        let epochLoss = 0;
        let correctPredictions = 0;
        
        // Learning Rate Scheduler (Cosine Annealing)
        const initialLr = 0.005;
        const finalLr = 0.0001;
        const currentLr = finalLr + 0.5 * (initialLr - finalLr) * (1 + Math.cos((epoch / maxEpochs) * Math.PI));

        for (let i = 0; i < parsedData.length; i += batchSize) {
            // Create batch with Data Augmentation (Jittering)
            const batch = parsedData.slice(i, i + batchSize).map(item => {
                return {
                    inputs: item.inputs.map(val => val + (randomNormal() * 0.01)), // 1% gaussian noise
                    target: item.target
                };
            });
            
            const loss = model.trainBatch(batch, currentLr, 0.9, 0.999, 1e-8, 0.005, classWeights);
            epochLoss += loss * batch.length;
            
            // Calculate accuracy for batch (without jittering/dropout for evaluation)
            const evalBatch = parsedData.slice(i, i + batchSize);
            for (const item of evalBatch) {
                const { activations } = model.forward(item.inputs, false);
                const pred = activations[activations.length - 1][0];
                if ((pred >= 0.5 && item.target >= 0.5) || (pred < 0.5 && item.target < 0.5)) {
                    correctPredictions++;
                }
            }
        }

        epochLoss /= parsedData.length;
        const accuracy = (correctPredictions / parsedData.length) * 100;
        finalAccuracy = accuracy;

        if (epochLoss < bestLoss) {
            bestLoss = epochLoss;
            epochsWithoutImprovement = 0;
            saveModelWeights(model, weightsFile, modelName);
        } else {
            epochsWithoutImprovement++;
        }

        if (epoch % 50 === 0) {
            console.log(`[AI-MODEL] Epoch ${epoch}/${maxEpochs} | Loss: ${epochLoss.toFixed(4)} | Best: ${bestLoss.toFixed(4)}`);
        }

        if (epochsWithoutImprovement >= 50) {
            console.log(`[AI-MODEL] Early stopping a epoch ${epoch} (loss non migliorata per 50 epoche)`);
            break;
        }
    }
    
    // Load best weights
    loadModelWeights(model, weightsFile);
    console.log(`[AI-MODEL] ${modelName} addestrato. Loss finale: ${bestLoss.toFixed(4)} | Accuracy: ${finalAccuracy.toFixed(2)}%`);
}

// --- Feature Extraction ---

function getBuyFeatures(stats) {
    const liquidityUsd = stats.liquidityUsd || 0;
    const rugCheckScore = stats.rugCheckScore || 0;
    const insidersDetected = stats.insiderMetrics?.insidersDetected ? 1 : 0;
    const top10Concentration = stats.insiderMetrics?.top10Concentration || 0;
    const creatorHoarding = stats.insiderMetrics?.creatorHoarding || stats.insiderMetrics?.creatorBalance || 0;
    const volume5mUsd = stats.volume5mUsd || 0;
    const volume24hUsd = stats.volume24hUsd || 0;
    const buys5m = stats.buys5m || 0;
    const sells5m = stats.sells5m || 0;
    const priceChange24h = stats.priceChange24h || 0;

    // Deep contract features
    const cf = stats.contractFeatures || {};
    const lpLockedPct = cf.lpLockedPct || 0;
    const mintAuthorityRevoked = cf.mintAuthorityRevoked !== undefined ? cf.mintAuthorityRevoked : 0;
    const freezeAuthorityRevoked = cf.freezeAuthorityRevoked !== undefined ? cf.freezeAuthorityRevoked : 0;

    // Temporal features
    const tf = stats.temporalFeatures || {};
    const priceVelocity1m = tf.priceVelocity1m || 0;
    const volumeVelocity1m = tf.volumeVelocity1m || 0;
    const priceVelocity3m = tf.priceVelocity3m || 0;
    const volumeVelocity3m = tf.volumeVelocity3m || 0;
    const tokenAgeMinutes = tf.tokenAgeMinutes || 0;

    return [
        // --- Original 12 features ---
        Math.min(1, Math.log10(Math.max(1, liquidityUsd)) / 6),             // 0: liquidity (log)
        rugCheckScore / 100,                                                 // 1: rug check score
        insidersDetected,                                                    // 2: insider flag
        top10Concentration / 100,                                            // 3: top10 concentration
        Math.min(1, creatorHoarding / 1e9),                                  // 4: creator hoarding
        Math.min(1, Math.log10(Math.max(1, volume5mUsd)) / 6),              // 5: volume 5m (log)
        Math.min(1, Math.log10(Math.max(1, volume24hUsd)) / 6),             // 6: volume 24h (log)
        Math.min(1, buys5m / 100),                                           // 7: buys 5m
        (Math.max(-100, Math.min(100, priceChange24h)) + 100) / 200,         // 8: price change 24h
        Math.min(1, (liquidityUsd / Math.max(1, volume24hUsd))),             // 9: liquidity/volume ratio
        buys5m / Math.max(1, buys5m + sells5m),                              // 10: buy pressure
        Math.min(1, (volume5mUsd * 288) / Math.max(1, volume24hUsd)),        // 11: momentum score
        // --- NEW: Smart Contract features ---
        lpLockedPct / 100,                                                   // 12: LP locked %
        mintAuthorityRevoked,                                                // 13: mint authority revoked (0/1)
        freezeAuthorityRevoked,                                              // 14: freeze authority revoked (0/1)
        // --- NEW: Temporal velocity features ---
        (Math.max(-50, Math.min(50, priceVelocity1m)) + 50) / 100,          // 15: price velocity 1m
        Math.min(1, Math.max(0, volumeVelocity1m / 3)),                      // 16: volume velocity 1m (capped at 3x)
        (Math.max(-50, Math.min(50, priceVelocity3m)) + 50) / 100,          // 17: price velocity 3m
        Math.min(1, Math.max(0, volumeVelocity3m / 3)),                      // 18: volume velocity 3m (capped at 3x)
        Math.min(1, tokenAgeMinutes / 60),                                   // 19: token age (up to 1 hour)
        
        // --- NEW: Alpha features (AI Max Improve) ---
        Math.min(1, Math.log10(Math.max(1, sells5m)) / 6),                   // 20: sells 5m (log)
        (liquidityUsd > 0 ? Math.min(1, volume5mUsd / liquidityUsd) : 0),    // 21: 5m volume/liquidity ratio
        (liquidityUsd > 0 ? Math.min(1, (creatorHoarding / 1e9) / (liquidityUsd / 10000)) : 0), // 22: creator balance vs liquidity
        Math.max(0, 1 - (lpLockedPct / 100))                                 // 23: LP unlocked % risk flag
    ];
}

function getBuyTarget(pnlPercent) {
    if (pnlPercent <= -50) return 0.00;
    if (pnlPercent <= -20) return 0.10;
    if (pnlPercent <= -5) return 0.25;
    if (pnlPercent <= 0) return 0.35;
    if (pnlPercent <= 10) return 0.55;
    if (pnlPercent <= 25) return 0.70;
    if (pnlPercent <= 50) return 0.85;
    return 1.00;
}

function getSellFeatures(data) {
    const pnlPercent = data.pnlPercent || 0;
    const timeHeldMinutes = data.timeHeldMinutes || 1;
    const priceVelocity1m = data.priceVelocity1m || 0;
    const priceVelocity3m = data.priceVelocity3m || 0;
    const volumeVelocity = data.volumeVelocity || 0;
    const liquidityUsd = data.liquidityUsd || 0;
    const volatility = data.volatility || 0;

    return [
        (Math.max(-100, Math.min(200, pnlPercent)) + 100) / 300,
        Math.min(1, timeHeldMinutes / 120),
        (Math.max(-50, Math.min(50, priceVelocity1m)) + 50) / 100,
        (Math.max(-50, Math.min(50, priceVelocity3m)) + 50) / 100,
        (Math.max(-100, Math.min(100, volumeVelocity)) + 100) / 200,
        Math.min(1, Math.log10(Math.max(1, liquidityUsd)) / 6),
        Math.min(1, volatility / 100)
    ];
}

function getSellTarget(data) {
    // If pnlAtSell > pnlAfterSell -> good sell (1.0), else premature (0.0)
    // Se non sappiamo pnlAfterSell, defaultiamo a 0.5 o cerchiamo di dedurlo.
    // Per il momento i dati di training vengono forniti con un target calcolabile:
    if (data.pnlAtSell !== undefined && data.pnlAfterSell !== undefined) {
        return data.pnlAtSell > data.pnlAfterSell ? 1.0 : 0.0;
    }
    return 0.5; 
}

// --- Exports ---

export async function evaluateToken(data) {
    // --- STAGE 1: Hard Heuristic Pre-Filters (no AI needed) ---
    // These catch obviously bad tokens before wasting NN compute
    const liquidityUsd = data.liquidityUsd || 0;
    const volume5mUsd = data.volume5mUsd || 0;
    const volume24hUsd = data.volume24hUsd || 0;
    const buys5m = data.buys5m || 0;
    const rugCheckScore = data.rugCheckScore || 0;
    const insidersDetected = data.insiderMetrics?.insidersDetected || 0;
    const top10Concentration = data.insiderMetrics?.top10Concentration || 0;
    const mintRevoked = data.contractFeatures?.mintAuthorityRevoked ?? 0;
    const freezeRevoked = data.contractFeatures?.freezeAuthorityRevoked ?? 0;

    // REJECT: Insiders detected by on-chain graph analysis
    if (insidersDetected) {
        return { score: 5, buy: false, reason: 'RIFIUTATO: Insider trading rilevato on-chain' };
    }

    // REJECT: Top 10 holders own >50% of supply (rug pull risk)
    if (top10Concentration > 50) {
        return { score: 10, buy: false, reason: `RIFIUTATO: Top 10 posseggono ${top10Concentration.toFixed(0)}% del supply` };
    }

    // REJECT: Mint authority not revoked (dev can print infinite tokens)
    if (!mintRevoked) {
        return { score: 8, buy: false, reason: 'RIFIUTATO: Mint authority non revocata (dev può stampare token)' };
    }

    // REJECT: Volume too low = no real interest, hard to exit
    if (volume5mUsd < 500) {
        return { score: 12, buy: false, reason: `RIFIUTATO: Volume 5m troppo basso ($${volume5mUsd.toFixed(0)})` };
    }

    // REJECT: No buyers in last 5 minutes
    if (buys5m < 3) {
        return { score: 15, buy: false, reason: `RIFIUTATO: Solo ${buys5m} acquisti negli ultimi 5 min` };
    }

    // REJECT: Rug check score too high (>40 = risky)
    if (rugCheckScore > 40) {
        return { score: 10, buy: false, reason: `RIFIUTATO: RugCheck score troppo alto (${rugCheckScore})` };
    }

    // --- STAGE 2: Neural Network Evaluation ---
    const features = getBuyFeatures(data);
    const { activations } = buyModel.forward(features);
    const rawScore = activations[activations.length - 1][0];
    
    // --- STAGE 3: Confidence Penalty ---
    // When we have few quality training samples, the NN output is unreliable.
    // Penalize the score proportionally to how little data we have.
    const qualitySamples = buyTrainingData.filter(d => !d.lowQuality).length;
    let confidenceMultiplier = 1.0;
    
    if (data.trainingMode && data.dryRun) {
        // [HOTFIX] Override penalty during Paper-Trading Training Mode
        // This is necessary to allow the bot to "explore" and buy tokens to collect feedback,
        // otherwise it gets deadlocked because it never buys anything.
        confidenceMultiplier = 1.0;
    } else if (qualitySamples < 10) {
        confidenceMultiplier = 0.6;  // Heavy penalty: NN barely trained
    } else if (qualitySamples < 25) {
        confidenceMultiplier = 0.75; // Moderate penalty
    } else if (qualitySamples < 50) {
        confidenceMultiplier = 0.85; // Light penalty
    } else if (qualitySamples < 100) {
        confidenceMultiplier = 0.95; // Almost full confidence
    }
    
    const adjustedScore = rawScore * confidenceMultiplier;
    const scorePercent = Math.round(adjustedScore * 100);
    
    // Threshold: 75% (was 60% — more selective)
    const BUY_THRESHOLD = 75;
    const isBuy = scorePercent >= BUY_THRESHOLD;
    
    // --- STAGE 4: Dynamic Sizing & Adaptive TP/SL (Phase 2) ---
    let suggestedAmountRatio = 0;
    let suggestedTp = 50;
    let suggestedSl = -20;
    
    if (isBuy) {
        // Sizing: scales from 0.5 (at 75%) to 1.0 (at 100%)
        suggestedAmountRatio = 0.5 + ((scorePercent - BUY_THRESHOLD) / (100 - BUY_THRESHOLD)) * 0.5;
        
        // Volatility measure: volume / liquidity. High ratio = highly volatile = wider TP/SL
        const volLiqRatio = liquidityUsd > 0 ? (volume5mUsd / liquidityUsd) : 1;
        
        if (volLiqRatio > 2) {
            // Highly volatile: wider net
            suggestedTp = 100; // 100% gain target
            suggestedSl = -35; // Allow more drawdown
        } else if (volLiqRatio > 0.5) {
            // Normal volatility
            suggestedTp = 75;
            suggestedSl = -25;
        } else {
            // Low volatility / stable
            suggestedTp = 40;
            suggestedSl = -15;
        }
    }
    
    return {
        score: scorePercent,
        buy: isBuy,
        suggestedAmountRatio: suggestedAmountRatio,
        suggestedTp: suggestedTp,
        suggestedSl: suggestedSl,
        reason: isBuy 
            ? `AI APPROVATO: confidenza ${scorePercent}% (raw: ${Math.round(rawScore*100)}%, penalty: x${confidenceMultiplier}, dati: ${qualitySamples}) | Sizing: ${Math.round(suggestedAmountRatio * 100)}%, TP: +${suggestedTp}%, SL: ${suggestedSl}%`
            : `AI RIFIUTATO: confidenza ${scorePercent}% < soglia ${BUY_THRESHOLD}% (raw: ${Math.round(rawScore*100)}%, penalty: x${confidenceMultiplier}, dati: ${qualitySamples})`
    };
}

export async function reportFeedback(feedback) {
    let lowQuality = false;
    const stats = feedback.originalStats || {};
    
    if ((stats.liquidityUsd === 15000 && stats.rugCheckScore === 80) || 
        (!stats.liquidityUsd && !stats.rugCheckScore)) {
        lowQuality = true;
    }

    const dataPoint = {
        symbol: feedback.symbol,
        pnlPercent: feedback.pnlPercent,
        originalStats: feedback.originalStats || null,
        lowQuality: lowQuality
    };

    buyTrainingData.push(dataPoint);
    if (useMongo) {
        const doc = new TrainingData({ type: 'BUY', ...dataPoint });
        doc.save().catch(e => console.error(e));
    } else {
        ensureDir(DATA_FILE);
        fs.writeFileSync(DATA_FILE, JSON.stringify(buyTrainingData, null, 2));
    }

    // Feature extractor that handles both old format (input field) and new format (originalStats)
    const extractFeatures = (d) => {
        const stats = d.originalStats || d.input || {};
        return getBuyFeatures(stats);
    };

    trainModel(
        buyModel, 
        buyTrainingData, 
        extractFeatures, 
        d => getBuyTarget(d.pnlPercent || (d.output ? (d.output.score > 0.5 ? 20 : -20) : 0)), 
        BUY_MODEL_WEIGHTS, 
        "BUY_MODEL"
    );

    return { success: true, message: 'Feedback registrato e modello riaddestrato' };
}

export async function evaluateSell(data) {
    const pnlPercent = data.pnlPercent || 0;
    const liquidityUsd = data.liquidityUsd || 0;

    if (liquidityUsd < 5000 && liquidityUsd > 0) return { sell: true, score: 95, reason: 'AI Panic Sell (Liquidità prosciugata < 5k)' };
    if (pnlPercent <= -90) return { sell: true, score: 100, reason: 'AI Hard Stop Loss (Rugpull protection)' };

    const features = getSellFeatures(data);
    const { activations } = sellModel.forward(features);
    const qValues = activations[activations.length - 1];
    
    const qHold = qValues[0];
    const qSell = qValues[1];
    
    const sell = qSell > qHold;
    const confidence = Math.abs(qSell - qHold).toFixed(2);
    
    return {
        sell,
        score: sell ? qSell : qHold,
        reason: sell ? `AI Q-Sell (Advantage: +${confidence})` : `AI Q-Hold (Advantage: +${confidence})`,
        qValues: { hold: qHold, sell: qSell }
    };
}

export async function reportSellFeedback(data) {
    sellTrainingData.push(data);
    if (useMongo) {
        const doc = new TrainingData({ type: 'SELL', ...data });
        doc.save().catch(e => console.error(e));
    } else {
        ensureDir(SELL_DATA_FILE);
        fs.writeFileSync(SELL_DATA_FILE, JSON.stringify(sellTrainingData, null, 2));
    }

    trainModel(
        sellModel,
        sellTrainingData,
        d => getSellFeatures(d),
        d => getSellTarget(d),
        SELL_MODEL_WEIGHTS,
        "SELL_MODEL"
    );
}


export async function trainRLAgent(experiences) {
    if (!experiences || experiences.length === 0) return;
    
    const gamma = 0.95;
    const batch = [];
    
    for (const exp of experiences) {
        const features = getSellFeatures(exp.state);
        const { activations } = sellModel.forward(features);
        const currentQ = [...activations[activations.length - 1]]; 
        
        let targetQ;
        if (exp.done) {
            targetQ = exp.reward;
        } else {
            const nextFeatures = getSellFeatures(exp.nextState);
            const { activations: nextActivations } = sellModel.forward(nextFeatures);
            const nextQ = nextActivations[nextActivations.length - 1];
            const maxNextQ = Math.max(nextQ[0], nextQ[1]);
            targetQ = exp.reward + gamma * maxNextQ;
        }
        
        const targetValues = [...currentQ];
        targetValues[exp.action] = targetQ; 
        
        batch.push({ inputs: features, target: targetValues });
    }
    
    let totalLoss = 0;
    // Batch size of 16
    for(let i=0; i<batch.length; i+=16) {
        const b = batch.slice(i, i+16);
        totalLoss += sellModel.trainBatch(b);
    }
    
    saveModelWeights(sellModel, SELL_MODEL_WEIGHTS);
    console.log(`[AI-MODEL] RL Agent addestrato su ${batch.length} esperienze. MSE Loss: ${(totalLoss / Math.ceil(batch.length/16)).toFixed(4)}`);
}
