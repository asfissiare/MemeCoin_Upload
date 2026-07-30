const fs = require('fs');
const file = 'src/index.js';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes("import { logger }")) {
    content = "import { logger } from './logger.js';\n" + content;
}

if (!content.includes("logger.printAsciiArt()")) {
    content = content.replace(
        "async function main() {",
        "async function main() {\n  logger.printAsciiArt();\n  logger.info('Inizializzazione sistema in corso...');"
    );
}

fs.writeFileSync(file, content, 'utf8');
