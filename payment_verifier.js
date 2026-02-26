// payment_verifier.js (Gemini Only - Direct Connection)
const axios = require('axios');
const sharp = require('sharp');
const secrets = require('./secrets.js');

const GEMINI_API_KEY = secrets.GEMINI_API_KEY;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=";

// Strict prompt to ensure Gemini returns exactly what the bot needs
const ANALYSIS_PROMPT = `
ACT AS A GCASH RECEIPT SCANNER.
1. Find the 13-digit Reference Number (e.g., 0123 456 789 123).
2. Find the Amount Sent (PHP).
3. Check if the receipt looks edited or fake.

YOU MUST RESPOND ONLY WITH A JSON OBJECT. NO MARKDOWN. NO INTRO TEXT.
{
    "extracted_info": {
        "reference_number": "13DIGITS_ONLY_NO_SPACES",
        "amount": "NUMBER_ONLY",
        "date": "TEXT_DATE"
    },
    "verification_status": "APPROVED",
    "reasoning": "Explain shortly"
}
`;

/**
 * Compresses and converts image to Base64
 */
async function encodeImage(imageBuffer) {
    try {
        let resizedBuffer = await sharp(imageBuffer)
            .resize({ width: 800, withoutEnlargement: true })
            .png()
            .toBuffer();
        return resizedBuffer.toString('base64');
    } catch (error) {
        console.error("Image processing error:", error);
        return null;
    }
}

/**
 * Cleans AI response and extracts the JSON block
 */
function cleanAndParseJSON(text) {
    try {
        // Remove markdown formatting if AI provides it
        let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
        
        // Find the start { and end }
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        
        if (start !== -1 && end !== -1) {
            cleaned = cleaned.substring(start, end + 1);
            const parsed = JSON.parse(cleaned);
            
            // Auto-fix: Remove spaces from reference number (e.g. "0123 456..." -> "0123456...")
            if (parsed.extracted_info?.reference_number) {
                parsed.extracted_info.reference_number = String(parsed.extracted_info.reference_number).replace(/\s/g, "");
            }
            return parsed;
        }
        throw new Error("No JSON boundaries found");
    } catch (e) {
        console.error("AI Response Parsing Failed. Raw text was:", text);
        return null;
    }
}

/**
 * Main Function: Sends image direct to Google Gemini
 */
async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    if (!image_b64) {
        return {
            extracted_info: { reference_number: "Not Found" },
            verification_status: "REJECTED",
            reasoning: "No image data received."
        };
    }

    const payload = {
        "contents": [{
            "parts": [
                { "text": ANALYSIS_PROMPT },
                { "inline_data": { "mime_type": "image/png", "data": image_b64 } }
            ]
        }]
    };

    try {
        console.log("[AI] Analyzing receipt with Gemini Direct...");
        const response = await axios.post(`${BASE_URL}${GEMINI_API_KEY}`, payload, { timeout: 40000 });
        
        const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (aiText) {
            const result = cleanAndParseJSON(aiText);
            if (result) return result;
        }

        throw new Error("Empty or invalid response from Gemini.");

    } catch (error) {
        console.error("Gemini API Error:", error.message);
        return {
            extracted_info: { reference_number: "Not Found", amount: "Not Found" },
            verification_status: "REJECTED",
            reasoning: "The AI was unable to scan this receipt. Please try again or contact admin."
        };
    }
}

module.exports = { encodeImage, analyzeReceiptWithFallback };
