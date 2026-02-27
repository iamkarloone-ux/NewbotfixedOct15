// payment_verifier.js (Copy and Replace Entire File)
const axios = require('axios');
const sharp = require('sharp');
const secrets = require('./secrets.js');

const API_KEY = secrets.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

const ANALYSIS_PROMPT = `
ACT AS A GCASH RECEIPT SCANNER.
1. Find the 13-digit Reference Number (look for 'Ref No').
2. Find the total Amount Sent in PHP.

YOU MUST REPLY ONLY WITH A JSON OBJECT. NO TEXT.
{
    "extracted_info": {
        "reference_number": "13DIGITS_ONLY_NO_SPACES",
        "amount": "NUMBER_ONLY"
    },
    "verification_status": "APPROVED",
    "reasoning": "OCR result"
}
`;

async function encodeImage(imageBuffer) {
    try {
        const processed = await sharp(imageBuffer)
            .resize({ width: 1200 }) 
            .sharpen() 
            .toFormat('jpeg', { quality: 90 })
            .toBuffer();
        return processed.toString('base64');
    } catch (error) { return null; }
}

function cleanAndParseJSON(text) {
    try {
        const jsonMatch = text.match(/({[\s\S]*})/);
        if (!jsonMatch) return null;
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.extracted_info?.reference_number) {
            // Forcefully remove spaces: "123 456..." -> "123456..."
            parsed.extracted_info.reference_number = String(parsed.extracted_info.reference_number).replace(/\D/g, "");
        }
        return parsed;
    } catch (e) { return null; }
}

async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    const payload = {
        contents: [{ parts: [{ text: ANALYSIS_PROMPT }, { inline_data: { mime_type: "image/jpeg", data: image_b64 } }] }],
        generationConfig: { temperature: 0, response_mime_type: "application/json" }
    };
    try {
        const response = await axios.post(API_URL, payload, { headers: { "Content-Type": "application/json" }, timeout: 35000 });
        const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return aiText ? cleanAndParseJSON(aiText) : null;
    } catch (error) {
        return { extracted_info: { reference_number: "Not Found" }, verification_status: "REJECTED" };
    }
}
module.exports = { encodeImage, analyzeReceiptWithFallback };
