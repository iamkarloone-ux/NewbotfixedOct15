// language_manager.js (Fixed Pathing for 'locales' folder)
const fs = require('fs');
const path = require('path');

let enData = {};
let tlData = {};

try {
    // FIXED: Tells the bot to look inside the 'locales' folder for en.json
    enData = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'en.json'), 'utf8'));
} catch (e) {
    console.error("Warning: Could not load en.json. Check file path.", e.message);
}

try {
    // FIXED: Tells the bot to look inside the 'locales' folder for tl.json
    tlData = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'tl.json'), 'utf8'));
} catch (e) {
    console.error("Warning: Could not load tl.json. Check file path.", e.message);
}

// Load all language files into memory safely
const locales = {
    en: enData,
    tl: tlData
};

/**
 * Gets a text string in the specified language.
 * @param {string} key - The key of the text to retrieve (e.g., 'welcome_message').
 * @param {string} lang - The language code ('en' or 'tl'). Defaults to 'en'.
 * @returns {string} The translated text. If a key is not found, it returns the key itself.
 */
function getText(key, lang = 'en') {
    // Default to English if the specified language or key doesn't exist
    return locales[lang]?.[key] || locales['en']?.[key] || key;
}

module.exports = { getText };
