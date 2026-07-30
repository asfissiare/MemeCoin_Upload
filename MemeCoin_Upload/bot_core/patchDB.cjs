const fs = require('fs');
const file = 'src/userDatabase.js';
let content = fs.readFileSync(file, 'utf8');

// Add language to user object
if (!content.includes('language:')) {
    content = content.replace(
        /dashboardAuthToken: crypto\.randomBytes\(16\)\.toString\('hex'\)/g,
        "dashboardAuthToken: crypto.randomBytes(16).toString('hex'),\n      language: 'en'"
    );
}

if (!content.includes('setLanguage(userId')) {
    content = content.replace(
        /getUserInfo\(userId\) \{/g,
        "setLanguage(userId, lang) {\n    let user = this.users.get(userId);\n    if (!user) return;\n    user.language = lang;\n    this.save();\n  }\n\n  getUserInfo(userId) {"
    );
}

fs.writeFileSync(file, content, 'utf8');
