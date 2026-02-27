// user_handler/support_flow.js
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');

// --- View Proofs ---
async function handleViewProofs(sender_psid, userLang = 'en') {
    const proofMessage = lang.getText('proofs_message', userLang);
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, proofMessage, replies);
}


// --- Admin Contact ---
async function promptForAdminMessage(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('contact_admin_prompt', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_admin_message', { lang: userLang });
}

async function forwardMessageToAdmin(sender_psid, text, ADMIN_ID, userLang = 'en') {
    const userName = await messengerApi.getUserProfile(sender_psid);
    const forwardMessage = `📩 Message from ${userName} (${sender_psid}):\n\n"${text}"\n\nTo reply, use the admin menu.`;
    await messengerApi.sendText(ADMIN_ID, forwardMessage);
    await messengerApi.sendText(sender_psid, lang.getText('contact_admin_success', userLang));
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}


// --- Report Issue Feature ---
async function promptForReportRef(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('report_prompt_ref', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_report_ref', { lang: userLang });
}

async function processReportRef(sender_psid, text, userLang = 'en') {
    const refNumber = text.trim();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    if (!/^\d{13}$/.test(refNumber)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_invalid_format', userLang), replies);
        return;
    }
    const ref = await db.getReference(refNumber);
    if (!ref) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('report_not_found', userLang), replies);
        return;
    }
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('report_prompt_issue', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_report_issue_desc', { refNumber, lang: userLang });
}

async function processReportDescription(sender_psid, text, ADMIN_ID, userLang = 'en') {
    const { refNumber } = stateManager.getUserState(sender_psid);
    const issueDescription = text.trim();
    const userName = await messengerApi.getUserProfile(sender_psid);
    
    const adminNotification = `🚨 NEW ACCOUNT ISSUE REPORT 🚨\n\nUser: ${userName} (${sender_psid})\nReference: ${refNumber}\n\nIssue:\n"${issueDescription}"`;
    await messengerApi.sendText(ADMIN_ID, adminNotification);
    
    await messengerApi.sendText(sender_psid, lang.getText('report_success_user', userLang));
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}


module.exports = {
    handleViewProofs,
    promptForAdminMessage,
    forwardMessageToAdmin,
    promptForReportRef,
    processReportRef,
    processReportDescription
};
 
