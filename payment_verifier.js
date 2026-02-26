// payment_verifier.js (OpenRouter Version - Multi-Model Support)
const axios = require('axios');
const sharp = require('sharp');
const secrets = require('./secrets.js');

const API_KEY = secrets.OPENROUTER_API_KEY;
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

// We use Llama 3.2 Vision. It's fast, functional, and often free.
// Alternative: "openai/gpt-4o-mini" (Very accurate but costs pennies)
const MODEL_NAME = "meta-llama/llama-3.2-11b-vision-instruct:free";

const ANALYSIS_PROMPT = `
ACT AS A GCASH RECEIPT SCANNER.
Look at the image and find:
1. The 13-digit Reference Number (e.g., 0011 222 333 444).
2. The exact Amount Sent in PHP.

OUTPUT ONLY VALID JSON. DO NOT ADD TEXT OR MARKDOWN.
{
    "extracted_info": {
        "reference_number": "13DIGITS_ONLY",
        "amount": "NUMBER_ONLY",
        "date": "DATE_TEXT"
    },
    "verification_status": "APPROVED",
    "reasoning": "Quick note"
}
`;

/**
 * Optimizes the image for AI processing
 */
async function encodeImage(imageBuffer) {
    try {
        const resized = await sharp(imageBuffer)
            .resize({ width: 800 })
            .toFormat('jpeg')
            .toBuffer();
        return resized.toString('base64');
    } catch (error) {
        console.error("Image processing error:", error);
        return null;
    }
}

/**
 * Extracts JSON from the AI response (strips markdown if needed)
 */
function cleanAndParseJSON(text) {
    try {
        const jsonMatch = text.match(/({[\s\S]*})/);
        if (jsonMatch && jsonMatch[0]) {
            let cleaned = jsonMatch[0];
            const parsed = JSON.parse(cleaned);
            
            // Critical: Remove spaces from the reference number
            if (parsed.extracted_info?.reference_number) {
                parsed.extracted_info.reference_number = String(parsed.extracted_info.reference_number).replace(/\s/g, "");
            }
            return parsed;
        }
    } catch (e) {
        console.error("Failed to parse AI JSON. Output was:", text);
    }
    return null;
}

/**
 * Main Function: Sends image to OpenRouter
 */
async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    if (!image_b64) return null;

    const payload = {
        model: MODEL_NAME,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: ANALYSIS_PROMPT },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/jpeg;base64,${image_b64}`
                        }
                    }
                ]
            }
        ]
    };

    try {
        console.log(`[AI] Analyzing with ${MODEL_NAME} via OpenRouter...`);
        const response = await axios.post(API_URL, payload, {
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            timeout: 45000
        });

        const aiText = response.data?.choices?.[0]?.message?.content;
        
        if (aiText) {
            const result = cleanAndParseJSON(aiText);
            if (result) return result;
        }

        throw new Error("AI response was empty or malformed.");

    } catch (error) {
        console.error("OpenRouter API Error:", error.response?.data || error.message);
        return {
            extracted_info: { reference_number: "Not Found" },
            verification_status: "REJECTED",
            reasoning: "AI Error: Could not scan receipt."
        };
    }
}

module.exports = { encodeImage, analyzeReceiptWithFallback };
