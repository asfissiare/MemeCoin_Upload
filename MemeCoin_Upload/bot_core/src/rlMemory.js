import fs from 'fs';
import path from 'path';

const MEMORY_FILE = path.join(process.cwd(), 'data', 'rl_memory.json');

export class RLMemory {
    constructor() {
        this.experiences = [];
        this.loadMemory();
    }

    loadMemory() {
        try {
            if (fs.existsSync(MEMORY_FILE)) {
                const data = fs.readFileSync(MEMORY_FILE, 'utf8');
                this.experiences = JSON.parse(data);
            }
        } catch (err) {
            console.error('[RL-MEMORY] Errore caricamento memoria:', err.message);
        }
    }

    saveMemory() {
        try {
            const dir = path.dirname(MEMORY_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.experiences, null, 2));
        } catch (err) {
            console.error('[RL-MEMORY] Errore salvataggio memoria:', err.message);
        }
    }

    addExperience(experience) {
        this.experiences.push(experience);
        // Keep only last 10000 experiences
        if (this.experiences.length > 10000) {
            this.experiences.shift();
        }
        this.saveMemory();
    }
    
    getBatch() {
        // Return recent ones that haven't been trained on (or all for now)
        const batch = [...this.experiences];
        this.experiences = []; // Clear after training
        this.saveMemory();
        return batch;
    }
}

export const rlMemory = new RLMemory();
