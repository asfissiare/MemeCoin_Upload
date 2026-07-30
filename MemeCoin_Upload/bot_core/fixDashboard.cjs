const fs = require('fs');
let text = fs.readFileSync('src/dashboard.js', 'utf8');
text = text.replace(/\\`/g, '`');
text = text.replace(/\\\$/g, '$');
fs.writeFileSync('src/dashboard.js', text);
