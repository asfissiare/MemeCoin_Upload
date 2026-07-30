const fs = require('fs');

let content = fs.readFileSync('src/aiModel.js', 'utf8');

// Add imports
content = content.replace(
    "import { fileURLToPath } from 'url';", 
    "import { fileURLToPath } from 'url';\nimport { TrainingData, ModelWeights } from './db/models.js';\nlet useMongo = false;"
);

// Replace loadModelWeights
const loadModelWeightsRegex = /function loadModelWeights\([\s\S]*?return false;\n}/;
const newLoadModelWeights = `async function loadModelWeights(model, filePath, modelName) {
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
            console.error(\`[AI-MODEL] Errore nel caricamento pesi da \${filePath}\`, e);
        }
    }
    return false;
}`;
content = content.replace(loadModelWeightsRegex, newLoadModelWeights);

// Replace saveModelWeights
const saveModelWeightsRegex = /function saveModelWeights\([\s\S]*?fs\.writeFileSync\([\s\S]*?\);\n}/;
const newSaveModelWeights = `async function saveModelWeights(model, filePath, modelName) {
    if (useMongo && modelName) {
        try {
            await ModelWeights.findOneAndUpdate({ name: modelName }, { name: modelName, weights: model.getState() }, { upsert: true });
        } catch(e) { console.error('[AI-MODEL] Errore salvataggio pesi MongoDB', e); }
    } else {
        ensureDir(filePath);
        fs.writeFileSync(filePath, JSON.stringify(model.getState(), null, 2));
    }
}`;
content = content.replace(saveModelWeightsRegex, newSaveModelWeights);

// Replace loadData with initAIModel
const loadDataRegex = /function loadData\(\) \{[\s\S]*?console\.log\(`\[AI-MODEL\] Sell Model caricato con successo \(\$\{sellTrainingData\.length\} campioni nel dataset\)\.`\);\n    \}\n}/;
const newLoadData = `export async function initAIModel() {
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
        console.log(\`[AI-MODEL] Buy Model caricato con successo (\${buyTrainingData.length} campioni nel dataset).\`);
    }

    const sellLoaded = await loadModelWeights(sellModel, SELL_MODEL_WEIGHTS, 'SELL_MODEL');
    if (!sellLoaded) {
        console.log('[AI-MODEL] Pesi del Sell Model non trovati.');
    } else {
        console.log(\`[AI-MODEL] Sell Model caricato con successo (\${sellTrainingData.length} campioni nel dataset).\`);
    }
}`;
content = content.replace(loadDataRegex, newLoadData);

// Fix trainModel calls to use async save
content = content.replace(/saveModelWeights\(model, weightsFile\);/g, 'saveModelWeights(model, weightsFile, modelName);');

// Fix reportFeedback to use MongoDB
const reportFeedbackRegex = /buyTrainingData\.push\(dataPoint\);\n    ensureDir\(DATA_FILE\);\n    fs\.writeFileSync\(DATA_FILE, JSON\.stringify\(buyTrainingData, null, 2\)\);/g;
const newReportFeedback = `buyTrainingData.push(dataPoint);
    if (useMongo) {
        const doc = new TrainingData({ type: 'BUY', ...dataPoint });
        doc.save().catch(e => console.error(e));
    } else {
        ensureDir(DATA_FILE);
        fs.writeFileSync(DATA_FILE, JSON.stringify(buyTrainingData, null, 2));
    }`;
content = content.replace(reportFeedbackRegex, newReportFeedback);

// Fix reportSellFeedback
const reportSellFeedbackRegex = /sellTrainingData\.push\(data\);\n    ensureDir\(SELL_DATA_FILE\);\n    fs\.writeFileSync\(SELL_DATA_FILE, JSON\.stringify\(sellTrainingData, null, 2\)\);/g;
const newReportSellFeedback = `sellTrainingData.push(data);
    if (useMongo) {
        const doc = new TrainingData({ type: 'SELL', ...data });
        doc.save().catch(e => console.error(e));
    } else {
        ensureDir(SELL_DATA_FILE);
        fs.writeFileSync(SELL_DATA_FILE, JSON.stringify(sellTrainingData, null, 2));
    }`;
content = content.replace(reportSellFeedbackRegex, newReportSellFeedback);

// Fix trainModel call in reportFeedback
content = content.replace(/"Buy Model"/g, '"BUY_MODEL"');
content = content.replace(/"Sell Model"/g, '"SELL_MODEL"');

// Remove synchronous loadData();
content = content.replace(/\n\/\/ Initialize on startup\nloadData\(\);\n/g, '\n');

fs.writeFileSync('src/aiModel.js', content, 'utf8');
