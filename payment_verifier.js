// payment_verifier.js (Fully Corrected Version with q= parameter first)
const axios = require('axios');
const sharp = require('sharp');
const secrets = require('./secrets.js');

const KAIZ_API_KEY = secrets.KAIZ_API_KEY;
const GEMINI_API_KEY = secrets.GEMINI_API_KEY;

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=";

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

const KAIZ_ANALYSIS_PROMPT = `
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


async function sendKaizRequest(imageUrl) {
    console.log("Attempting analysis with Primary API (Kaiz-APIs)...");
    const encodedPrompt = encodeURIComponent(KAIZ_ANALYSIS_PROMPT);
    const encodedImageUrl = encodeURIComponent(imageUrl);
    
    // --- EDITED THIS LINE AS REQUESTED ---
    const KAIZ_API_URL = `https://kaiz-apis.gleeze.com/api/gemini-vision?q=${encodedPrompt}&uid=3&imageUrl=${encodedImageUrl}&apikey=${KAIZ_API_KEY}`;

    try {
        const response = await axios.get(KAIZ_API_URL, { timeout: 45000 });

        console.log(`[KAIZ API] Raw response received:`, response.data);

        if (!response.data || !response.data.response) {
            throw new Error(`Kaiz-API responded with an error: ${response.data.error || 'No response data'}`);
        }

        const rawText = response.data.response;
        const jsonMatch = rawText.match(/({[\s\S]*})/);
        if (jsonMatch && jsonMatch[0]) {
            const parsedJson = JSON.parse(jsonMatch[0]);
            if (parsedJson.verification_status && parsedJson.extracted_info) {
                console.log("Primary API (Kaiz-APIs) analysis successful.");
                return parsedJson;
            }
        }
        throw new Error("Response from Kaiz-APIs did not contain a valid JSON object.");

    } catch (error) {
        console.error("Primary API (Kaiz-APIs) request failed:", error.message);
        throw error; // Propagate the error to trigger the fallback
    }
}

async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    try {
        const primaryResult = await sendKaizRequest(imageUrl);
        return primaryResult;
    } catch (primaryError) {
        console.warn("Primary API (Kaiz-APIs) failed. Proceeding to Fallback API (Gemini)...");
        try {
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
 
