import { getDashboardUrl } from './src/dashboard.js';
import http from 'http';

http.get('http://localhost:3000/?token=f7ae09bd1ba3959e4d75a161f8198badb9e9ca74de994762219eeb661f3306c5', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log("Response length:", data.length);
        console.log("Response status:", res.statusCode);
        if (res.statusCode !== 200) console.log(data);
        process.exit(0);
    });
}).on('error', (err) => {
    console.error("HTTP GET ERROR:", err);
});
