// payment_verifier.js
const axios = require('axios');
const sharp = require('sharp');
const secrets = require('./secrets.js');

const API_KEY = secrets.GEMINI_API_KEY;

/**
 * We use the model string from the latest documentation.
 * This ensures we are using the most "functional" multimodal version.
 */
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

const ANALYSIS_PROMPT = `
ACT AS AN EXPERT GCASH RECEIPT SCANNER.
Scan the image carefully for:
1. The Reference Number: Look for exactly 13 digits (e.g. 0123 456 789 123).
2. The Amount Sent: The total PHP value.
3. Authenticity: Check if the receipt looks edited or fake.

YOU MUST REPLY ONLY WITH A VALID JSON OBJECT. NO MARKDOWN. NO INTRO TEXT.
{
    "extracted_info": {
        "reference_number": "13DIGITS_ONLY_NO_SPACES",
        "amount": "NUMBER_ONLY",
        "date": "DATE_AND_TIME"
    },
    "verification_status": "APPROVED",
    "reasoning": "Quick scan results"
}
`;

/**
 * Sharpens and encodes the image into Base64 (JPEG) as required by the API.
 */
async function encodeImage(imageBuffer) {
    try {
        const resized = await sharp(imageBuffer)
            .resize({ width: 1024 }) // Optimal size for OCR
            .toFormat('jpeg')
            .toBuffer();
        return resized.toString('base64');
    } catch (error) {
        console.error("Image processing error:", error);
        return null;
    }
}

/**
 * Cleans AI response and extracts the JSON block to prevent parsing errors.
 */
function cleanAndParseJSON(text) {
    try {
        const jsonMatch = text.match(/({[\s\S]*})/);
        if (jsonMatch && jsonMatch[0]) {
            const parsed = JSON.parse(jsonMatch[0]);
            
            // Critical: Remove any non-digits from the reference number
            if (parsed.extracted_info?.reference_number) {
                parsed.extracted_info.reference_number = String(parsed.extracted_info.reference_number).replace(/\D/g, "");
            }
            return parsed;
        }
    } catch (e) {
        console.error("JSON Error. AI output was:", text);
    }
    return null;
}

/**
 * Main function: Sends the multimodal prompt to Gemini.
 */
async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    if (!image_b64) return null;

    // This payload follows the exact structure of the curl command in your image.
    const payload = {
        contents: [{
            parts: [
                {
                    inline_data: {
                        mime_type: "image/jpeg",
                        data: image_b64
                    }
                },
                { text: ANALYSIS_PROMPT }
            ]
        }],
        generationConfig: {
            temperature: 0.1, // High precision
            response_mime_type: "application/json" // Force JSON output
        }
    };

    try {
        console.log(`[AI] Analyzing receipt with Flash Multimodal API...`);
        const response = await axios.post(API_URL, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 35000
        });

        // The text result is located in candidates[0].content.parts[0].text
        const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (aiText) {
            const result = cleanAndParseJSON(aiText);
            if (result) return result;
        }

        throw new Error("Invalid or empty response from AI");

    } catch (error) {
        console.error("Gemini API Error:", error.response?.data || error.message);
        return {
            extracted_info: { reference_number: "Not Found", amount: "Not Found" },
            verification_status: "REJECTED",
            reasoning: "The AI system failed to read the receipt. Please contact admin."
        };
    }
}

module.exports = { encodeImage, analyzeReceiptWithFallback };
