// payment_verifier.js (Updated with Norch Project API)
const axios = require('axios');
const sharp = require('sharp');
const secrets = require('./secrets.js');

// KAIZ_API_KEY is no longer needed for the new API
const GEMINI_API_KEY = secrets.GEMINI_API_KEY;

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=";

const GEMINI_ANALYSIS_PROMPT = `
You are a highly-attentive payment verification assistant. Your task is to analyze payment receipt screenshots to check for legitimacy.
INSTRUCTIONS:
1.  Read all visible text from the receipt, paying close attention to Reference Number and Amount Sent.
2.  Critically assess the image for signs of digital manipulation.
3.  Make a final recommendation: APPROVED, FLAGGED, or REJECTED.
Respond in this exact JSON format. Do not include any other text, comments, or markdown formatting.
{
    "extracted_info": {
        "reference_number": "The 13-digit reference number you read, or 'Not Found'",
        "amount": "The amount you read, or 'Not Found'",
        "date": "The date and time you read, or 'Not Found'"
    },
    "verification_status": "APPROVED/FLAGGED/REJECTED",
    "reasoning": "A brief but specific explanation for your decision."
}
`;

const PRIMARY_ANALYSIS_PROMPT = `
CRITICAL INSTRUCTION: Analyze the provided GCash receipt. YOU MUST ONLY reply with a valid JSON object in the specified format. Do not add any introductory text, markdown, or explanations. Your entire response must be the JSON object itself.

{
    "extracted_info": {
        "reference_number": "The 13-digit reference number, or 'Not Found'",
        "amount": "The amount, or 'Not Found'",
        "date": "The date and time, or 'Not Found'"
    },
    "verification_status": "APPROVED/FLAGGED/REJECTED",
    "reasoning": "A brief explanation for your decision."
}
`;

async function encodeImage(imageBuffer) {
    try {
        let resizedBuffer = await sharp(imageBuffer)
            .resize({ width: 1024, withoutEnlargement: true })
            .png()
            .toBuffer();

        return resizedBuffer.toString('base64');
    } catch (error) {
        console.error("Image processing error:", error);
        return null;
    }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Fallback (Google Gemini Direct) ---
async function sendGeminiRequest(image_b64) {
    const payload = {
        "contents": [{
            "parts": [
                { "text": GEMINI_ANALYSIS_PROMPT },
                { "inline_data": { "mime_type": "image/png", "data": image_b64 } }
            ]
        }]
    };

    try {
        console.log(`Sending request to Gemini Vision API...`);
        const response = await axios.post(`${BASE_URL}${GEMINI_API_KEY}`, payload, { timeout: 60000 });
        
        if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            let content = response.data.candidates[0].content.parts[0].text;
            content = content.trim().replace('```json', '').replace('```', '');
            return JSON.parse(content);
        } else {
            console.error("Invalid response structure from Gemini API:", response.data);
            throw new Error("Invalid response structure from Gemini.");
        }
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`Gemini request failed:`, errorMessage);
        throw new Error(errorMessage);
    }
}

function createErrorJson(reason) {
    return {
        extracted_info: {},
        verification_status: "FLAGGED",
        reasoning: `Script Error: ${reason}`
    };
}

// --- Primary API (Norch Project) ---
async function sendNorchRequest(imageUrl) {
    console.log("Attempting analysis with Primary API (Norch)...");
    
    // Updated parameter names based on your cURL example: prompt and imageurl
    const encodedPrompt = encodeURIComponent(PRIMARY_ANALYSIS_PROMPT);
    const encodedImageUrl = encodeURIComponent(imageUrl);
    
    // New API Endpoint
    const API_URL = `https://norch-project.gleeze.com/api/gemini?prompt=${encodedPrompt}&imageurl=${encodedImageUrl}`;

    try {
        const response = await axios.get(API_URL, { timeout: 45000 });

        console.log(`[Norch API] Raw response received.`);

        if (!response.data || !response.data.response) {
            throw new Error(`Norch-API responded with an error or invalid format.`);
        }

        const rawText = response.data.response;
        
        // Find JSON object within the text response using Regex
        const jsonMatch = rawText.match(/({[\s\S]*})/);
        if (jsonMatch && jsonMatch[0]) {
            const parsedJson = JSON.parse(jsonMatch[0]);
            if (parsedJson.verification_status && parsedJson.extracted_info) {
                console.log("Primary API (Norch) analysis successful.");
                return parsedJson;
            }
        }
        
        console.error("Raw text from Norch:", rawText);
        throw new Error("Response from Norch-API did not contain a valid JSON object.");

    } catch (error) {
        console.error("Primary API (Norch) request failed:", error.message);
        throw error; // Propagate the error to trigger the fallback
    }
}

async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    try {
        // Try Norch (Primary)
        const primaryResult = await sendNorchRequest(imageUrl);
        return primaryResult;
    } catch (primaryError) {
        console.warn("Primary API (Norch) failed. Proceeding to Fallback API (Gemini)...");
        try {
            // Try Google Gemini (Fallback)
            const fallbackResult = await sendGeminiRequest(image_b64);
            return fallbackResult;
        } catch (fallbackError) {
            console.error("Fallback API (Gemini) also failed. Analysis could not be completed.");
            return createErrorJson("Both primary and fallback analysis APIs failed.");
        }
    }
}

module.exports = {
    encodeImage,
    analyzeReceiptWithFallback
};
