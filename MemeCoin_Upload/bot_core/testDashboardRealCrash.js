import { startDashboard } from './src/dashboard.js';
import http from 'http';
import { userDatabase } from './src/userDatabase.js';

async function run() {
    userDatabase.load();
    startDashboard(3001);
    console.log("Server started. Querying PUBLIC...");
    
    setTimeout(() => {
        http.get('http://localhost:3001/', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log("Response status:", res.statusCode);
                console.log("Has PUBBLICA warning?", data.includes('PUBBLICA'));
                if (res.statusCode !== 200) console.log(data);
                process.exit(0);
            });
        }).on('error', (err) => {
            console.error("HTTP GET ERROR:", err);
            process.exit(1);
        });
    }, 1500);
}

run();
