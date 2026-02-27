// user_handler/custom_mod_flow.js
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');

// Step 1: Ask user to choose between Money or Gold
async function promptForCustomMod(sender_psid, userLang = 'en') {
    const message = lang.getText('custom_mod_prompt_choice', userLang);
    const replies = [
        { title: "💰 Money", payload: "custom_money" },
        { title: "✨ Gold", payload: "custom_gold" },
        { title: "⬅️ Back to Menu", payload: "menu" }
    ];
    await messengerApi.sendQuickReplies(sender_psid, message, replies);
    stateManager.setUserState(sender_psid, 'awaiting_custom_mod_type', { lang: userLang });
}

// Step 2: User has chosen a type, now prompt for the amount
async function handleCustomModType(sender_psid, payload, userLang = 'en') {
    let prompt = '';
    const orderType = payload === 'custom_money' ? 'Money' : 'Gold';

    if (orderType === 'Money') {
        prompt = lang.getText('custom_mod_prompt_money', userLang);
    } else {
        prompt = lang.getText('custom_mod_prompt_gold', userLang);
    }
    
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, prompt, replies);
    stateManager.setUserState(sender_psid, 'awaiting_custom_mod_amount', { orderType, lang: userLang });
}

// Step 3: User has entered an amount, validate it and ask for payment
async function handleCustomModAmount(sender_psid, text, userLang = 'en') {
    const { orderType } = stateManager.getUserState(sender_psid);
    const orderAmount = text.trim();
    let price = 0;
    let errorMsg = '';

    if (orderType === 'Money') {
        const amountMil = parseFloat(orderAmount.replace(/[^0-9.]/g, ''));
        if (isNaN(amountMil) || amountMil < 5 || amountMil > 30) {
            errorMsg = lang.getText('custom_mod_invalid_money', userLang);
        } else if (amountMil >= 5 && amountMil <= 10) {
            price = 150;
        } else if (amountMil > 10 && amountMil <= 30) {
            price = 200;
        }
    } else { // Gold
        const amountK = parseFloat(orderAmount.replace(/[^0-9.]/g, ''));
        if (isNaN(amountK) || amountK < 1 || amountK > 6) {
            errorMsg = lang.getText('custom_mod_invalid_gold', userLang);
        } else {
            price = 150;
        }
    }
    
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    if (price === 0 || errorMsg) {
        await messengerApi.sendQuickReplies(sender_psid, errorMsg || 'An unexpected error occurred.', replies);
        return;
    }
    
    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "09123963204";
    const paymentMsg = lang.getText('custom_mod_prompt_payment', userLang)
        .replace('{orderAmount}', orderAmount)
        .replace('{orderType}', orderType)
        .replace('{price}', price)
        .replace('{gcashNumber}', gcashNumber);
        
    await messengerApi.sendQuickReplies(sender_psid, paymentMsg, replies);
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_custom_mod', { orderType, orderAmount, price, lang: userLang });
}

// Step 4: Handle the receipt for the custom mod
async function handleCustomModReceipt(sender_psid, analysis, sendText, sendImage, ADMIN_ID, imageUrl, userLang = 'en') {
    const { orderType, orderAmount, price } = stateManager.getUserState(sender_psid);
    const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, '');
    const amount = parseFloat(amountStr);
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    const userName = await messengerApi.getUserProfile(sender_psid);
    
    if (isNaN(amount) || !refNumber || !/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, lang.getText('custom_mod_receipt_fail', userLang));
        const adminNotification = `⚠️ CUSTOM MOD - AI FAILURE ⚠️\nUser: ${userName}\nOrder: ${orderAmount} ${orderType}\nAI could not read the receipt. Please check manually.`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    } else if (Math.abs(amount - price) > 0.01) {
        const mismatchMsg = lang.getText('custom_mod_mismatch', userLang).replace('{amount}', amount).replace('{price}', price);
        await sendText(sender_psid, mismatchMsg);
        const adminNotification = `⚠️ CUSTOM MOD - PRICE MISMATCH ⚠️\nUser: ${userName}\nOrder: ${orderAmount} ${orderType}\nExpected: ${price} PHP\nPaid: ${amount} PHP\nRef: ${refNumber}`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    } else {
        await sendText(sender_psid, lang.getText('custom_mod_success', userLang));
        const adminNotification = `✅ New Custom Mod Order!\nUser: ${userName} (${sender_psid})\nOrder: *${orderAmount} of ${orderType}*\nPrice: ${price} PHP\nRef No: ${refNumber}`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}


module.exports = {
    promptForCustomMod,
    handleCustomModType,
    handleCustomModAmount,
    handleCustomModReceipt
};
