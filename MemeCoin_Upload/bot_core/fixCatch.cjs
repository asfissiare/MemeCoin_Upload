const fs = require('fs');
let content = fs.readFileSync('src/dashboard.js', 'utf8');

// Fix the catch block to avoid crashing
const badCatch = `      } catch (err) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }`;

const goodCatch = `      } catch (err) {
        console.error('[DASHBOARD ERROR]', err);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end('Internal Server Error: ' + err.message);
      }`;

content = content.replace(badCatch, goodCatch);

// What if the error is in the table rendering?
// Let's also wrap renderHTML in a try/catch if we want, but logging the error is enough to see it.
fs.writeFileSync('src/dashboard.js', content, 'utf8');
