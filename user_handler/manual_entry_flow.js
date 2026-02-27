// user_handler/manual_entry_flow.js
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');

async function startManualEntryFlow(sender_psid, sendText, imageUrl, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('manual_entry_start', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_manual_ref', { imageUrl, lang: userLang });
}

async function handleManualReference(sender_psid, text, userLang = 'en') {
    const refNumber = text.trim();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    if (!/^\d{13}$/.test(refNumber)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('manual_entry_invalid_ref', userLang), replies);
        return;
    }
    const { imageUrl } = stateManager.getUserState(sender_psid);
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('error_no_mods_found', userLang), replies);
        stateManager.clearUserState(sender_psid);
        return stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    }
    let response = `${lang.getText('manual_entry_thanks', userLang)}\n`;
    mods.forEach(mod => { response += `🔹 Mod ${mod.id}: ${mod.name}\n   💰 Price: ${mod.price} PHP\n`; });
    response += `\n${lang.getText('manual_entry_prompt_mod', userLang)}`;
    await messengerApi.sendQuickReplies(sender_psid, response, replies);
    stateManager.setUserState(sender_psid, 'awaiting_manual_mod', { imageUrl, refNumber, lang: userLang });
}

async function handleManualModSelection(sender_psid, text, sendImage, ADMIN_ID, userLang = 'en') {
    const { imageUrl, refNumber } = stateManager.getUserState(sender_psid);
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('manual_entry_invalid_mod', userLang), replies);
        return;
    }
    try {
        const claimsAdded = await db.addReference(refNumber, sender_psid, modId);
        const claimsText = claimsAdded === 1 ? '1 replacement claim' : `${claimsAdded} replacement claims`;
        await messengerApi.sendText(sender_psid, lang.getText('manual_entry_success', userLang).replace('{modId}', mod.id).replace('{claimsText}', claimsText));
        const userName = await messengerApi.getUserProfile(sender_psid);
        const adminNotification = `⚠️ MANUAL REGISTRATION (AI FAILED) ⚠️\nUser: ${userName}\nRef No: ${refNumber}\nMod: ${mod.name}\nReceipt attached.`;
        await messengerApi.sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await messengerApi.sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
        } else {
            throw e;
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}


module.exports = {
    startManualEntryFlow,
    handleManualReference,
    handleManualModSelection,
};
 
