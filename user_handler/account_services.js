// user_handler/account_services.js
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');

// --- Check Claims ---
async function promptForCheckClaims(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_prompt', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_check', { lang: userLang });
}

async function processCheckClaims(sender_psid, refNumber, userLang = 'en') {
    let resultMsg = '';
    if (!/^\d{13}$/.test(refNumber.trim())) {
        resultMsg = lang.getText('claims_check_invalid_format', userLang);
    } else {
        const ref = await db.getReference(refNumber.trim());
        if (!ref) {
            resultMsg = lang.getText('claims_check_not_found', userLang);
        } else {
            const remaining = ref.claims_max - ref.claims_used;
            const claimsText = remaining === 1 ? '1 replacement account' : `${remaining} replacement accounts`;
            resultMsg = lang.getText('claims_check_result', userLang)
                .replace('{claimsText}', claimsText).replace('{modId}', ref.mod_id).replace('{modName}', ref.mod_name);
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, resultMsg, replies);
}

// --- Replacement Request ---
async function promptForReplacement(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_prompt', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement', { lang: userLang });
}

async function processReplacementRequest(sender_psid, refNumber, userLang = 'en') {
    const trimmedRef = refNumber.trim();
    let resultMsg = '';
    if (!/^\d{13}$/.test(trimmedRef)) {
        resultMsg = lang.getText('claims_check_invalid_format', userLang);
    } else {
        const ref = await db.getReference(trimmedRef);
        if (ref && ref.last_replacement_timestamp) {
            const lastReplacementTime = new Date(ref.last_replacement_timestamp).getTime();
            const twentyFourHours = 24 * 60 * 60 * 1000;
            if (Date.now() - lastReplacementTime < twentyFourHours) {
                resultMsg = lang.getText('replace_limit_reached', userLang);
            }
        }
        if (!resultMsg) {
            if (!ref || ref.claims_used >= ref.claims_max) {
                resultMsg = lang.getText('replace_no_claims', userLang);
            } else {
                const account = await db.getAvailableAccount(ref.mod_id);
                if (!account) {
                    resultMsg = lang.getText('replace_no_stock', userLang);
                } else {
                    await db.claimAccount(account.id);
                    await db.useClaim(ref.ref_number);
                    resultMsg = lang.getText('replace_success', userLang)
                        .replace('{modId}', ref.mod_id).replace('{username}', account.username).replace('{password}', account.password);
                }
            }
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, resultMsg, replies);
}

module.exports = {
    promptForCheckClaims,
    processCheckClaims,
    promptForReplacement,
    processReplacementRequest
};
 
