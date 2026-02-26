// payment_verifier.js (Direct Gemini 1.5 Flash)
const axios = require('axios');
const sharp = require('sharp');
const secrets = require('./secrets.js');

const API_KEY = secrets.GEMINI_API_KEY;
// Using Gemini 1.5 Flash (as per your curl request)
const API_URL = `https://www.google.com/url?sa=E&q=https%3A%2F%2Fgenerativelanguage.googleapis.com%2Fv1beta%2Fmodels%2Fgemini-flash-latest%3AgenerateContent}`;

const ANALYSIS_PROMPT = `
ACT AS A GCASH RECEIPT SCANNER.
Scan the image for:
1. The 13-digit Reference Number (e.g., 0012 345 678 901).
2. The exact Amount Sent in PHP.

OUTPUT ONLY VALID JSON. NO MARKDOWN. NO INTRO TEXT.
{
    "extracted_info": {
        "reference_number": "13DIGITS_ONLY_NO_SPACES",
        "amount": "NUMBER_ONLY",
        "date": "DATE_TEXT"
    },
    "verification_status": "APPROVED",
    "reasoning": "Scan complete"
}
`;

async function encodeImage(imageBuffer) {
    try {
        // Optimizing image for Gemini Vision
        const resized = await sharp(imageBuffer)
            .resize({ width: 1024 })
            .toFormat('jpeg')
            .toBuffer();
        return resized.toString('base64');
    } catch (error) {
        console.error("Image processing error:", error);
        return null;
    }
}

function cleanAndParseJSON(text) {
    try {
        // Remove markdown formatting like ```json ... ```
        const jsonMatch = text.match(/({[\s\S]*})/);
        if (jsonMatch && jsonMatch[0]) {
            const parsed = JSON.parse(jsonMatch[0]);
            
            // Auto-fix: Ensure reference number is a string with no spaces
            if (parsed.extracted_info?.reference_number) {
                parsed.extracted_info.reference_number = String(parsed.extracted_info.reference_number).replace(/\s/g, "");
            }
            return parsed;
        }
    } catch (e) {
        console.error("JSON Error. AI Text was:", text);
    }
    return null;
}

async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    if (!image_b64) return null;

    // This matches the Direct Gemini API payload structure
    const payload = {
        contents: [{
            parts: [
                { text: ANALYSIS_PROMPT },
                { 
                    inline_data: { 
                        mime_type: "image/jpeg", 
                        data: image_b64 
                    } 
                }
            ]
        }]
    };

    try {
        console.log(`[AI] Analyzing receipt via Direct Gemini API...`);
        const response = await axios.post(API_URL, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 30000
        });

        // Gemini returns data in candidates[0].content.parts[0].text
        const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (aiText) {
            const result = cleanAndParseJSON(aiText);
            if (result) return result;
        }

        throw new Error("Invalid response from Gemini");

    } catch (error) {
        console.error("Gemini Direct Error:", error.response?.data || error.message);
        return {
            extracted_info: { reference_number: "Not Found" },
            verification_status: "REJECTED",
            reasoning: "The AI was unable to scan this receipt."
        };
    }
}

module.exports = { encodeImage, analyzeReceiptWithFallback };
