// index.js (Final Corrected Version with All Fixes)
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // FIXED: Moved axios import to the top
const dbManager = require('./database.js');
const stateManager = require('./state_manager.js');
const userHandler = require('./user_handler');
const adminHandler = require('./admin_handler.js');
const secrets = require('./secrets.js');
const paymentVerifier = require('./payment_verifier.js');
const { sendText, sendImage, sendQuickReplies, getUserProfile } = require('./messenger_api.js');
const lang = require('./language_manager');
const { handleUserError } = require('./error_handler.js'); // FIXED: Now properly imported

const app = express();
app.use(express.json());
const { VERIFY_TOKEN, ADMIN_ID, WORKER_SECRET_TOKEN } = secrets;

app.post('/webhook-delivery', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        if (token !== WORKER_SECRET_TOKEN) {
            console.warn("Unauthorized delivery attempt received.");
            return res.status(403).send('Forbidden');
        }
        const { job_id, username, password } = req.body;
        if (!job_id || !username || !password) {
            console.error("Invalid delivery payload received:", req.body);
            return res.status(400).send('Bad Request: Missing required fields.');
        }
        const job = await dbManager.getJobById(job_id);
        if (!job) {
            console.error(`Delivery received for a non-existent Job ID: ${job_id}`);
            return res.status(404).send('Job Not Found');
        }
        const userMessage = lang.getText('delivery_success', job.lang) + `\n\n📧 Username: \`${username}\`\n🔐 Password: \`${password}\`\n\nThank you for your trust! Enjoy! 💙`;
        await sendText(job.user_psid, userMessage);
        await dbManager.updateJobStatus(job_id, 'delivered', 'Successfully delivered to user.');
        console.log(`Successfully delivered credentials for Job ID: ${job_id} to user ${job.user_psid}`);
        res.status(200).send('OK');
    } catch (error) {
        console.error("--- ERROR in /webhook-delivery ---", error);
        try {
            const { job_id } = req.body;
            if (job_id) {
                const job = await dbManager.getJobById(job_id);
                if (job) {
                    await sendText(job.user_psid, lang.getText('delivery_failed_user', job.lang));
                    await sendText(ADMIN_ID, `🚨 AUTOMATION DELIVERY FAILED! 🚨\nJob ID ${job_id} for user ${job.user_psid} could not be delivered after creation. Please intervene manually.`);
                }
            }
        } catch (notificationError) {
            console.error("--- FATAL ERROR in delivery error handler ---", notificationError);
        }
        res.status(500).send('Internal Server Error');
    }
});

async function handleReceiptSubmission(sender_psid, imageUrl) {
    const userState = stateManager.getUserState(sender_psid);
    const userLang = userState?.lang || 'en';
    await sendText(sender_psid, lang.getText('receipt_analyzing', userLang));

    console.log(`[RECEIPT-STEP 1] Received image for analysis. URL: ${imageUrl}`);

    try {
        const imageResponse = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');

        console.log(`[RECEIPT-STEP 2] Successfully downloaded image. Buffer size: ${imageBuffer.length} bytes.`);

        const image_b64 = await paymentVerifier.encodeImage(imageBuffer);
        if (!image_b64) throw new Error("Failed to encode image.");

        console.log(`[RECEIPT-STEP 3] Image encoded. Calling AI for analysis...`);

        const analysis = await paymentVerifier.analyzeReceiptWithFallback(imageUrl, image_b64);

        console.log(`[RECEIPT-STEP 6] Received analysis from AI:`, JSON.stringify(analysis, null, 2));

        if (!analysis) throw new Error("AI analysis returned null.");

        const receiptsDir = path.join(__dirname, 'receipts');
        if (!fs.existsSync(receiptsDir)) { fs.mkdirSync(receiptsDir); }
        const imagePath = path.join(receiptsDir, `${sender_psid}_${Date.now()}.png`);
        fs.writeFileSync(imagePath, imageBuffer);

        const currentStateAfterAnalysis = stateManager.getUserState(sender_psid);
        
        if (currentStateAfterAnalysis && currentStateAfterAnalysis.state === 'processing_receipt') {
            if (currentStateAfterAnalysis.orderType) { // FIXED: Removed destructive .data reference
                await userHandler.handleCustomModReceipt(sender_psid, analysis, sendText, sendImage, ADMIN_ID, imageUrl, userLang);
            } else {
                await userHandler.handleReceiptAnalysis(sender_psid, analysis, ADMIN_ID, userLang);
            }
        } else {
            console.warn(`[WARN] Receipt analysis for ${sender_psid} finished, but state was no longer 'processing_receipt'. State is now: ${currentStateAfterAnalysis?.state}. Aborting post-analysis actions.`);
        }

    } catch (error) {
        console.error(`--- CRITICAL FAILURE IN handleReceiptSubmission ---`, error);

        const currentState = stateManager.getUserState(sender_psid);
        if (currentState && currentState.state === 'processing_receipt') {
            await userHandler.startManualEntryFlow(sender_psid, imageUrl, userLang);
        } else {
            await handleUserError(error, sender_psid, userLang, 'Receipt Submission'); // FIXED: Using error_handler
        }
    }
}

async function handleMessage(sender_psid, webhook_event) {
    try {
        const message = webhook_event.message;
        let received_text = null;
        if (message?.quick_reply?.payload) { received_text = message.quick_reply.payload; }
        else if (message?.text) { received_text = message.text; }
        const lowerCaseText = received_text?.toLowerCase().trim();

        const isAdmin = await dbManager.isAdmin(sender_psid);
        const userStateObjForLang = stateManager.getUserState(sender_psid);
        const userLangForMaint = userStateObjForLang?.lang || 'en';

        const isMaintenance = await dbManager.getMaintenanceStatus();
        if (isMaintenance && !isAdmin) {
            await sendText(sender_psid, lang.getText('maintenance_mode_message', userLangForMaint));
            return;
        }

        if (isAdmin) {
            const userStateObj = stateManager.getUserState(sender_psid);
            const state = userStateObj?.state;
            if (lowerCaseText === 'menu') {
                stateManager.clearUserState(sender_psid);
                return adminHandler.showAdminMenu(sender_psid, sendText);
            }
            if (lowerCaseText === 'my id') { return sendText(sender_psid, `Your Facebook Page-Scoped ID is: ${sender_psid}`); }
            if (state) {
                switch (state) {
                    case 'awaiting_reply_psid': return adminHandler.promptForReply_Step2_GetUsername(sender_psid, received_text, sendText);
                    case 'awaiting_reply_username': return adminHandler.promptForReply_Step3_GetPassword(sender_psid, received_text, sendText);
                    case 'awaiting_reply_password': return adminHandler.processReply_Step4_Send(sender_psid, received_text, sendText);
                    case 'viewing_references': const currentPage = userStateObj.page || 1; if (lowerCaseText === '1') return adminHandler.handleViewReferences(sender_psid, sendText, currentPage + 1); if (lowerCaseText === '2') return adminHandler.handleViewReferences(sender_psid, sendText, currentPage - 1); break;
                    case 'awaiting_bulk_accounts_mod_id': return adminHandler.processBulkAccounts_Step2_GetAccounts(sender_psid, received_text, sendText);
                    case 'awaiting_bulk_accounts_list': return adminHandler.processBulkAccounts_Step3_SaveAccounts(sender_psid, received_text, sendText);
                    case 'awaiting_edit_mod_id': return adminHandler.processEditMod_Step2_AskDetail(sender_psid, received_text, sendText);
                    case 'awaiting_edit_mod_detail_choice': return adminHandler.processEditMod_Step3_AskValue(sender_psid, received_text, sendText);
                    case 'awaiting_edit_mod_new_value': return adminHandler.processEditMod_Step4_SaveValue(sender_psid, received_text, sendText);
                    case 'awaiting_edit_mod_continue': return adminHandler.processEditMod_Step5_Continue(sender_psid, received_text, sendText);
                    case 'awaiting_add_ref_number': return adminHandler.processAddRef_Step2_GetMod(sender_psid, received_text, sendText);
                    case 'awaiting_add_ref_mod_id': return adminHandler.processAddRef_Step3_Save(sender_psid, received_text, sendText);
                    case 'awaiting_edit_admin': return adminHandler.processEditAdmin(sender_psid, received_text, sendText);
                    case 'awaiting_edit_ref': return adminHandler.processEditRef(sender_psid, received_text, sendText);
                    case 'awaiting_add_mod': return adminHandler.processAddMod(sender_psid, received_text, sendText);
                    case 'awaiting_delete_ref': return adminHandler.processDeleteRef(sender_psid, received_text, sendText);
                    case 'awaiting_admin_create_email': return adminHandler.promptForAdminCreate_Step2_GetMod(sender_psid, received_text, sendText);
                    case 'awaiting_admin_create_mod_id': return adminHandler.processAdminCreate_Step3_CreateJob(sender_psid, received_text, sendText);
                    case 'awaiting_bulk_refs_mod_id': return adminHandler.processBulkRefs_Step2_GetRefs(sender_psid, received_text, sendText);
                    case 'awaiting_bulk_refs_list': return adminHandler.processBulkRefs_Step3_SaveRefs(sender_psid, received_text, sendText);
                    case 'awaiting_pause_toggle_psid': return adminHandler.processPauseToggle(sender_psid, received_text, sendText);
                    case 'awaiting_delete_accounts_mod_id': return adminHandler.processDeleteAccounts_Step2_ConfirmAndDelete(sender_psid, received_text, sendText);
                    case 'awaiting_broadcast_message': return adminHandler.processBroadcast_Step2_ConfirmAndSend(sender_psid, received_text, sendText);
                    case 'awaiting_broadcast_confirmation': return adminHandler.processBroadcast_Step3_Execute(sender_psid, received_text, sendText);
                    case 'awaiting_edit_claims_ref': return adminHandler.promptForEditClaims_Step2_GetNewClaims(sender_psid, received_text, sendText);
                    case 'awaiting_edit_claims_values': return adminHandler.processEditClaims_Step3_Update(sender_psid, received_text, sendText);
                    case 'awaiting_sales_stats_period': return adminHandler.processSalesStats(sender_psid, received_text, sendText);
                }
            } else {
                switch (lowerCaseText) {
                    case '1': return adminHandler.handleViewReferences(sender_psid, sendText, 1);
                    case '2': return adminHandler.promptForBulkAccounts_Step1_ModId(sender_psid, sendText);
                    case '3': return adminHandler.promptForEditMod_Step1_ModId(sender_psid, sendText);
                    case '4': return adminHandler.promptForAddRef_Step1_GetRef(sender_psid, sendText);
                    case '5': return adminHandler.promptForEditAdmin(sender_psid, sendText);
                    case '6': return adminHandler.promptForEditRef(sender_psid, sendText);
                    case '7': return adminHandler.promptForAddMod(sender_psid, sendText);
                    case '8': return adminHandler.promptForDeleteRef(sender_psid, sendText);
                    case '9': return adminHandler.toggleAdminOnlineStatus(sender_psid, sendText);
                    case '10': return adminHandler.promptForReply_Step1_GetPSID(sender_psid, sendText);
                    case '11': return adminHandler.handleViewJobs(sender_psid, sendText);
                    case '12': return adminHandler.promptForAdminCreate_Step1_GetEmail(sender_psid, sendText);
                    case '13': return adminHandler.promptForBulkRefs_Step1_GetModId(sender_psid, sendText);
                    case '14': return adminHandler.promptForPauseToggle_GetPSID(sender_psid, sendText);
                    case '15': return adminHandler.toggleMaintenanceMode(sender_psid, sendText);
                    case '16': return adminHandler.promptForDeleteAccounts_Step1_GetModId(sender_psid, sendText);
                    case '17': return adminHandler.promptForBroadcast_Step1_GetMessage(sender_psid, sendText);
                    case '18': return adminHandler.promptForEditClaims_Step1_GetRef(sender_psid, sendText);
                    case '19': return adminHandler.promptForSalesStats(sender_psid, sendText);
                    default: return adminHandler.showAdminMenu(sender_psid, sendText);
                }
            }
        } else {
            const isPaused = await dbManager.isUserPaused(sender_psid);
            if (isPaused) return;

            const userStateObj = stateManager.getUserState(sender_psid);

            if (!userStateObj || !userStateObj.lang) {
                let lang = 'en';
                if (lowerCaseText === 'lang_en' || lowerCaseText === 'english') { lang = 'en'; }
                else if (lowerCaseText === 'lang_tl' || lowerCaseText === 'tagalog') { lang = 'tl'; }
                else {
                    const langPrompt = "Please select your language:";
                    const replies =[{ title: "English", payload: "lang_en" }, { title: "Tagalog", payload: "lang_tl" }];
                    await sendQuickReplies(sender_psid, langPrompt, replies);
                    stateManager.setUserState(sender_psid, 'awaiting_language_choice', {});
                    return;
                }
                await dbManager.addUser(sender_psid, lang);
                stateManager.setUserState(sender_psid, 'language_set', { lang });
                await userHandler.showUserMenu(sender_psid, lang);
                return;
            }

            const userLang = userStateObj.lang;
            const state = userStateObj?.state;

            if (state === 'processing_receipt') {
                await sendText(sender_psid, lang.getText('processing_receipt_wait', userLang));
                return; 
            }

            const expectingReceipt = state === 'awaiting_receipt_for_purchase' || state === 'awaiting_receipt_for_custom_mod';

            if (expectingReceipt && webhook_event.message?.attachments?.[0]?.type === 'image') {
                if (!webhook_event.message?.sticker_id) {
                    const imageUrl = webhook_event.message.attachments[0].payload.url;

                    const currentState = stateManager.getUserState(sender_psid);
                    const { state: ignoredState, timestamp, ...rest } = currentState || {}; // FIXED: Flatten state properly
                    stateManager.setUserState(sender_psid, 'processing_receipt', { ...rest, lang: userLang });
                    
                    await handleReceiptSubmission(sender_psid, imageUrl);
                }
                return;
            }
            if (expectingReceipt && received_text) {
                await sendText(sender_psid, lang.getText('receipt_cancelled_text_instead', userLang));
                stateManager.clearUserState(sender_psid);
                stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
                return;
            }
            if (!received_text || received_text === '' || webhook_event.message?.sticker_id) {
                return userHandler.showUserMenu(sender_psid, userLang);
            }
            if (lowerCaseText === 'menu') {
                stateManager.clearUserState(sender_psid);
                stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
                return userHandler.showUserMenu(sender_psid, userLang);
            }
            if (lowerCaseText === 'my id') { return sendText(sender_psid, `Your Facebook Page-Scoped ID is: ${sender_psid}`); }

            if (state) {
                switch (state) {
                    case 'awaiting_want_mod': return userHandler.handleWantMod(sender_psid, received_text, userLang);
                    case 'awaiting_email_for_purchase': return userHandler.handleEmailForPurchase(sender_psid, received_text, userLang);
                    case 'awaiting_mod_confirmation': return userHandler.handleModConfirmation(sender_psid, lowerCaseText, ADMIN_ID, userLang);
                    case 'awaiting_mod_clarification': return userHandler.handleModClarification(sender_psid, received_text, ADMIN_ID, userLang);
                    case 'awaiting_manual_ref': return userHandler.handleManualReference(sender_psid, received_text, userLang);
                    case 'awaiting_manual_mod': return userHandler.handleManualModSelection(sender_psid, received_text, sendImage, ADMIN_ID, userLang);
                    case 'awaiting_ref_for_check': return userHandler.processCheckClaims(sender_psid, received_text, userLang);
                    case 'awaiting_ref_for_replacement': return userHandler.processReplacementRequest(sender_psid, received_text, userLang);
                    case 'awaiting_custom_mod_type': return userHandler.handleCustomModType(sender_psid, received_text, userLang);
                    case 'awaiting_custom_mod_amount': return userHandler.handleCustomModAmount(sender_psid, received_text, userLang);
                    case 'awaiting_admin_message': return userHandler.forwardMessageToAdmin(sender_psid, received_text, ADMIN_ID, userLang);
                    case 'awaiting_report_ref': return userHandler.processReportRef(sender_psid, received_text, userLang);
                    case 'awaiting_report_issue_desc': return userHandler.processReportDescription(sender_psid, received_text, ADMIN_ID, userLang);
                }
            }
            switch (lowerCaseText) {
                case '1': return userHandler.handleViewMods(sender_psid, userLang);
                case '2': return userHandler.promptForCheckClaims(sender_psid, userLang);
                case '3': return userHandler.promptForReplacement(sender_psid, userLang);
                case '4': return userHandler.promptForCustomMod(sender_psid, userLang);
                case '5': return userHandler.promptForAdminMessage(sender_psid, userLang);
                case '6': return userHandler.handleViewProofs(sender_psid, userLang);
                case '7': return userHandler.promptForReportRef(sender_psid, userLang);
                default: return userHandler.showUserMenu(sender_psid, userLang);
            }
        }
    } catch (error) {
        const userStateObjForLang = stateManager.getUserState(sender_psid);
        const userLang = userStateObjForLang?.lang || 'en';
        await handleUserError(error, sender_psid, userLang, 'Master Message Handler'); // FIXED: Error Handler
    }
}

async function startServer() {
    try {
        await dbManager.setupDatabase();
        app.get('/', (req, res) => { res.status(200).send('Bot is online and healthy.'); });
        app.get('/webhook', (req, res) => {
            const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log("Webhook verified successfully!");
                res.status(200).send(challenge);
            } else { res.sendStatus(403); }
        });
        
        app.post('/webhook', async (req, res) => { // FIXED: Async route
            if (req.body.object === 'page') {
                // FIXED: Wait for each message to finish processing
                for (const entry of req.body.entry) {
                    const event = entry.messaging[0];
                    if (event?.sender?.id && (event.message || event.postback)) {
                        await handleMessage(event.sender.id, event);
                    }
                }
                res.status(200).send('EVENT_RECEIVED');
            } else { res.sendStatus(404); }
        });
        
        const PORT = process.env.PORT || 3000;
        const HOST = '0.0.0.0';
        app.listen(PORT, HOST, () => { console.log(`✅ Bot is listening on port ${PORT} at host ${HOST}.`); });
    } catch (error) {
        console.error("Server failed to start:", error);
        process.exit(1);
    }
}

startServer(); 
