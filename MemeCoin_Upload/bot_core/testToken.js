import { userDatabase } from './src/userDatabase.js';

const tokenToFind = "f7ae09bd1ba3959e4d75a161f8198badb9e9ca74de994762219eeb661f3306c5";
let found = null;
for (const [userId, user] of userDatabase.users.entries()) {
    console.log(`Checking user: ${userId}, token: ${user.dashboardAuthToken}`);
    if (user.dashboardAuthToken === tokenToFind) {
        found = userId;
    }
}
console.log('Result targetUserId:', found);
