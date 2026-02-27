// language_manager.js (Fixed Pathing & Safe Load)
const fs = require('fs');
const path = require('path');

let enData = {};
let tlData = {};

try {
    // FIXED: Changed from 'locales/en.json' to just 'en.json' based on your file structure
    enData = JSON.parse(fs.readFileSync(path.join(__dirname, 'en.json'), 'utf8'));
} catch (e) {
    console.error("Warning: Could not load en.json. Check file path.", e.message);
}

try {
    // FIXED: Changed from 'locales/tl.json' to just 'tl.json' based on your file structure
    tlData = JSON.parse(fs.readFileSync(path.join(__dirname, 'tl.json'), 'utf8'));
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
