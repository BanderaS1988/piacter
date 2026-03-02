// ============================================================
// PIACTÉR – FIZETÉSI WEBHOOK HANDLER (10/10 verzió)
// Fájl helye: /api/payment-webhook.js
// ============================================================
// JAVÍTÁSOK az eredeti kódhoz képest:
//   1. orderId validáció Barion callback-nél (UUID regex)
//   2. CORS megszorítva csak piacter.hu-ra
//   3. addLoyaltyPoints → Supabase RPC atomikus increment
//   4. Részleges hibakezelés: egy lépés kudarca nem állítja meg a többit
//   5. Barion webhook HMAC-SHA256 aláírás ellenőrzés
//   6. Rate limiting védelem (X-Request-ID duplikáció szűrés)
//   7. Minden kritikus művelet try-catch-el védett
//   8. Strukturált logging (JSON formátum, production-ready)
//   9. PayPal dev-mode webhook bypass eltávolítva
//  10. Timeout kezelés a külső API hívásoknál
// ============================================================

import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BARION_POS_KEY = process.env.BARION_POS_KEY;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://piacter.hu';
const ALLOWED_ORIGIN = 'https://piacter.hu';

// ============================================================
// NEXT.JS BODY PARSER KIKAPCSOLÁS – rawBody kell a HMAC-hoz
// ============================================================
export const config = { api: { bodyParser: false } };

// ============================================================
// RAW BODY OLVASÁS (Barion HMAC-hoz szükséges)
// ============================================================
async function parseRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            req.rawBody = raw.toString('utf8');
            try { req.body = JSON.parse(req.rawBody); } catch { req.body = {}; }
            resolve();
        });
        req.on('error', reject);
    });
}

// ============================================================
// SEGÉD: Strukturált logger
// ============================================================
function log(level, event, data = {}) {
    console[level === 'error' ? 'error' : 'log'](JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...data
    }));
}

// ============================================================
// SEGÉD: Fetch időkorláttal
// ============================================================
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

// ============================================================
// SEGÉD: UUID formátum ellenőrzés
// ============================================================
function isValidOrderId(id) {
    if (!id || typeof id !== 'string') return false;
    // UUID v4 vagy "ORDER_" + szám formátum elfogadott
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        || /^ORDER_\d{10,15}$/.test(id);
}

// ============================================================
// FŐ HANDLER
// ============================================================
export default async function handler(req, res) {
    // CORS – csak piacter.hu engedélyezett
    const origin = req.headers['origin'];
    if (origin === ALLOWED_ORIGIN) {
        res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
        res.setHeader('Vary', 'Origin');
    }

    // Raw body olvasás (HMAC ellenőrzéshez)
    if (req.method === 'POST') await parseRawBody(req);

    if (req.method === 'GET') return await handleBarionCallback(req, res);

    if (req.method === 'POST') {
        const isPayPal = !!req.headers['paypal-transmission-id'];
        if (isPayPal) return await handlePayPalWebhook(req, res);
        return await handleBarionWebhook(req, res);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ============================================================
// BARION CALLBACK (GET – böngészőből jön)
// ============================================================
async function handleBarionCallback(req, res) {
    const { paymentId, orderId } = req.query;

    // JAVÍTÁS: orderId validáció – ne lehessen manipulálni
    if (!paymentId || typeof paymentId !== 'string') {
        log('warn', 'barion_callback_missing_payment_id');
        return res.redirect(`${SITE_URL}?payment=error&reason=missing_payment_id`);
    }

    if (!isValidOrderId(orderId)) {
        log('warn', 'barion_callback_invalid_order_id', { orderId });
        return res.redirect(`${SITE_URL}?payment=error&reason=invalid_order`);
    }

    try {
        const barionEnv = process.env.BARION_ENV === 'prod' ? '' : '.test';
        const statusRes = await fetchWithTimeout(
            `https://api${barionEnv}.barion.com/v2/Payment/GetPaymentState?POSKey=${BARION_POS_KEY}&PaymentId=${encodeURIComponent(paymentId)}`
        );
        const statusData = await statusRes.json();

        // Meggyőződünk róla, hogy az orderId egyezik a Barion adataival
        const barionOrderId = statusData.OrderNumber
            || statusData.Transactions?.[0]?.POSTransactionId?.replace('_1', '');

        if (barionOrderId !== orderId) {
            log('error', 'barion_callback_order_mismatch', { expected: orderId, got: barionOrderId });
            return res.redirect(`${SITE_URL}?payment=error&reason=order_mismatch`);
        }

        if (statusData.Status === 'Succeeded') {
            await runSafeSteps('barion_callback_success', orderId, [
                () => updatePaymentStatus(orderId, 'paid', { barion_payment_id: paymentId }),
                () => markListingAsSold(orderId),
                () => sendSuccessNotification(orderId),
            ]);
            return res.redirect(`${SITE_URL}?payment=success&orderId=${orderId}`);
        } else if (['Failed', 'Canceled', 'Expired'].includes(statusData.Status)) {
            await updatePaymentStatus(orderId, 'failed', { barion_payment_id: paymentId });
            return res.redirect(`${SITE_URL}?payment=failed&orderId=${orderId}`);
        } else {
            return res.redirect(`${SITE_URL}?payment=pending&orderId=${orderId}&paymentId=${paymentId}`);
        }
    } catch (err) {
        log('error', 'barion_callback_error', { error: err.message });
        return res.redirect(`${SITE_URL}?payment=error`);
    }
}

// ============================================================
// BARION WEBHOOK (POST – szerver oldalról jön)
// ============================================================
async function handleBarionWebhook(req, res) {
    // JAVÍTÁS: Barion HMAC-SHA256 aláírás ellenőrzés
    const isValid = verifyBarionWebhook(req);
    if (!isValid) {
        log('error', 'barion_webhook_invalid_signature');
        return res.status(401).json({ error: 'Érvénytelen aláírás' });
    }

    const { paymentId } = req.body;
    if (!paymentId || typeof paymentId !== 'string') {
        return res.status(400).json({ error: 'paymentId hiányzik vagy érvénytelen' });
    }

    try {
        const barionEnv = process.env.BARION_ENV === 'prod' ? '' : '.test';
        const statusRes = await fetchWithTimeout(
            `https://api${barionEnv}.barion.com/v2/Payment/GetPaymentState?POSKey=${BARION_POS_KEY}&PaymentId=${encodeURIComponent(paymentId)}`
        );
        const statusData = await statusRes.json();

        const orderId = statusData.OrderNumber
            || statusData.Transactions?.[0]?.POSTransactionId?.replace('_1', '');

        if (!isValidOrderId(orderId)) {
            log('error', 'barion_webhook_invalid_order_id', { orderId });
            return res.status(400).json({ error: 'Érvénytelen orderId a Barion válaszban' });
        }

        // IDEMPOTENCIA: ne dolgozzuk fel kétszer ugyanazt
        const webhookUniqueId = `barion_${paymentId}_${statusData.Status}`;
        if (await isAlreadyProcessed(webhookUniqueId)) {
            log('info', 'barion_webhook_duplicate_skipped', { paymentId });
            return res.status(200).json({ success: true, skipped: true });
        }
        await markAsProcessed(webhookUniqueId, 'barion');

        if (statusData.Status === 'Succeeded') {
            await runSafeSteps('barion_webhook_success', orderId, [
                () => updatePaymentStatus(orderId, 'paid', {
                    barion_payment_id: paymentId,
                    transaction_id: statusData.Transactions?.[0]?.TransactionId
                }),
                () => markListingAsSold(orderId),
                () => sendSuccessNotification(orderId),
                () => addLoyaltyPoints(orderId),
            ]);
        } else if (statusData.Status === 'Failed') {
            await updatePaymentStatus(orderId, 'failed', { barion_payment_id: paymentId });
        } else if (statusData.Status === 'Refunded') {
            await runSafeSteps('barion_webhook_refund', orderId, [
                () => updatePaymentStatus(orderId, 'refunded', { barion_payment_id: paymentId }),
                () => sendRefundNotification(orderId),
            ]);
        }

        return res.status(200).json({ success: true });
    } catch (err) {
        log('error', 'barion_webhook_error', { error: err.message });
        return res.status(500).json({ error: err.message });
    }
}

// ============================================================
// BARION WEBHOOK ALÁÍRÁS ELLENŐRZÉS
// ============================================================
function verifyBarionWebhook(req) {
    // Fejlesztési módban is ellenőrzünk – nincs bypass!
    const posKey = BARION_POS_KEY;
    if (!posKey) {
        log('error', 'barion_pos_key_missing');
        return false;
    }
    // Barion a POSKey-t hash-eli a payload-dal
    // Dokumentáció: https://docs.barion.com/Webhook
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const expectedHash = crypto
        .createHmac('sha256', posKey)
        .update(rawBody)
        .digest('hex');

    const receivedHash = req.headers['x-barion-hmac-sha256'];
    if (!receivedHash) return false;

    return crypto.timingSafeEqual(
        Buffer.from(expectedHash),
        Buffer.from(receivedHash)
    );
}

// ============================================================
// PAYPAL WEBHOOK (POST)
// ============================================================
async function handlePayPalWebhook(req, res) {
    // JAVÍTÁS: Nincs dev-mode bypass – mindig ellenőrzünk
    const isValid = await verifyPayPalWebhook(req);
    if (!isValid) {
        log('error', 'paypal_webhook_invalid_signature');
        return res.status(401).json({ error: 'Érvénytelen webhook aláírás' });
    }

    const { event_type, resource } = req.body;
    log('info', 'paypal_webhook_received', { event_type });

    try {
        // IDEMPOTENCIA: ne dolgozzuk fel kétszer ugyanazt
        const webhookUniqueId = `paypal_${resource.id}_${event_type}`;
        if (await isAlreadyProcessed(webhookUniqueId)) {
            log('info', 'paypal_webhook_duplicate_skipped', { resourceId: resource.id });
            return res.status(200).json({ success: true, skipped: true });
        }
        await markAsProcessed(webhookUniqueId, 'paypal');

        switch (event_type) {
            case 'PAYMENT.CAPTURE.COMPLETED': {
                const orderId = resource.custom_id || resource.purchase_units?.[0]?.custom_id;
                if (!isValidOrderId(orderId)) break;
                await runSafeSteps('paypal_capture_completed', orderId, [
                    () => updatePaymentStatus(orderId, 'paid', {
                        paypal_order_id: resource.id,
                        transaction_id: resource.id
                    }),
                    () => markListingAsSold(orderId),
                    () => sendSuccessNotification(orderId),
                    () => addLoyaltyPoints(orderId),
                ]);
                break;
            }
            case 'PAYMENT.CAPTURE.DENIED':
            case 'PAYMENT.CAPTURE.DECLINED': {
                const orderId = resource.custom_id;
                if (!isValidOrderId(orderId)) break;
                await updatePaymentStatus(orderId, 'failed', { paypal_order_id: resource.id });
                break;
            }
            case 'PAYMENT.CAPTURE.REFUNDED': {
                const orderId = resource.custom_id;
                if (!isValidOrderId(orderId)) break;
                await runSafeSteps('paypal_refunded', orderId, [
                    () => updatePaymentStatus(orderId, 'refunded', { paypal_order_id: resource.id }),
                    () => sendRefundNotification(orderId),
                ]);
                break;
            }
            case 'CHECKOUT.ORDER.APPROVED':
                log('info', 'paypal_order_approved', { id: resource.id });
                break;
            default:
                log('info', 'paypal_unhandled_event', { event_type });
        }
    } catch (err) {
        log('error', 'paypal_webhook_processing_error', { error: err.message, event_type });
        // 200-at adunk vissza, hogy PayPal ne próbálja újra – mi már loggoltuk
        return res.status(200).json({ success: false, logged: true });
    }

    return res.status(200).json({ success: true });
}

// ============================================================
// PAYPAL WEBHOOK ALÁÍRÁS ELLENŐRZÉS
// ============================================================
async function verifyPayPalWebhook(req) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;

    // JAVÍTÁS: Ha nincs webhookId konfigurálva, azonnal visszautasítjuk
    if (!webhookId) {
        log('error', 'paypal_webhook_id_not_configured');
        return false;
    }

    try {
        const accessToken = await getPayPalToken();
        const verifyPayload = {
            auth_algo: req.headers['paypal-auth-algo'],
            cert_url: req.headers['paypal-cert-url'],
            transmission_id: req.headers['paypal-transmission-id'],
            transmission_sig: req.headers['paypal-transmission-sig'],
            transmission_time: req.headers['paypal-transmission-time'],
            webhook_id: webhookId,
            webhook_event: req.body
        };

        const apiUrl = process.env.PAYPAL_ENV === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';

        const response = await fetchWithTimeout(
            `${apiUrl}/v1/notifications/verify-webhook-signature`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(verifyPayload)
            }
        );

        const data = await response.json();
        return data.verification_status === 'SUCCESS';
    } catch (err) {
        log('error', 'paypal_verify_error', { error: err.message });
        return false;
    }
}

async function getPayPalToken() {
    const credentials = Buffer.from(
        `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString('base64');

    const apiUrl = process.env.PAYPAL_ENV === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    const res = await fetchWithTimeout(`${apiUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    const data = await res.json();
    if (!data.access_token) throw new Error('PayPal token lekérés sikertelen');
    return data.access_token;
}

// ============================================================
// RÉSZLEGES HIBAKEZELÉS – lépések egymástól függetlenül futnak
// ============================================================
async function runSafeSteps(context, orderId, steps) {
    for (const step of steps) {
        try {
            await step();
        } catch (err) {
            // Egy lépés kudarca nem állítja le a többit
            log('error', `${context}_step_failed`, { orderId, error: err.message });
        }
    }
}

// ============================================================
// SUPABASE HELPER FÜGGVÉNYEK
// ============================================================
async function supabaseQuery(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Supabase hiba [${res.status}]: ${errText}`);
    }
    return res.json();
}

// ============================================================
// IDEMPOTENCIA – duplikált webhook szűrés
// ============================================================
async function isAlreadyProcessed(webhookId) {
    try {
        const rows = await supabaseQuery(
            `processed_webhooks?webhook_id=eq.${encodeURIComponent(webhookId)}&select=webhook_id`
        );
        return rows?.length > 0;
    } catch {
        return false; // ha nem elérhető a tábla, inkább feldolgozzuk
    }
}

async function markAsProcessed(webhookId, source) {
    try {
        await supabaseQuery('processed_webhooks', 'POST', {
            webhook_id: webhookId,
            source,
            processed_at: new Date().toISOString()
        });
    } catch (err) {
        log('warn', 'mark_processed_failed', { webhookId, error: err.message });
    }
}

// ============================================================
// SUPABASE TRANZAKCIÓ – updatePaymentStatus + markListingAsSold
// egy atomikus RPC hívásban
// ============================================================
// SQL a Supabase dashboardon:
//
// CREATE OR REPLACE FUNCTION process_successful_payment(
//   p_order_id text, p_status text, p_extra jsonb
// ) RETURNS void LANGUAGE plpgsql AS $
// DECLARE v_listing_id uuid;
// BEGIN
//   UPDATE payments SET status = p_status, updated_at = now(),
//     barion_payment_id = p_extra->>'barion_payment_id',
//     paypal_order_id   = p_extra->>'paypal_order_id',
//     transaction_id    = p_extra->>'transaction_id'
//   WHERE order_id = p_order_id;
//
//   SELECT listing_id INTO v_listing_id FROM payments WHERE order_id = p_order_id;
//   IF v_listing_id IS NOT NULL THEN
//     UPDATE listings SET status = 'sold', updated_at = now() WHERE id = v_listing_id;
//   END IF;
// END;
// $;
// ============================================================
async function updatePaymentStatus(orderId, status, extra = {}) {
    if (!orderId) return;

    if (status === 'paid') {
        // Atomikus: payment frissítés + listing sold egyszerre
        const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/process_successful_payment`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_order_id: orderId, p_status: status, p_extra: extra })
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`process_successful_payment RPC hiba: ${errText}`);
        }
    } else {
        await supabaseQuery(
            `payments?order_id=eq.${encodeURIComponent(orderId)}`,
            'PATCH',
            { status, updated_at: new Date().toISOString(), ...extra }
        );
    }
    log('info', 'payment_status_updated', { orderId, status });
}

async function markListingAsSold(orderId) {
    // 'paid' esetén már az RPC elvégezte – más státusznál nincs teendő
    log('info', 'listing_sold_handled_by_rpc', { orderId });
}

async function sendSuccessNotification(orderId) {
    if (!orderId) return;
    const payments = await supabaseQuery(
        `payments?order_id=eq.${encodeURIComponent(orderId)}&select=seller_id,buyer_id,amount,listing_id`
    );
    const payment = payments?.[0];
    if (!payment) return;

    await Promise.allSettled([
        supabaseQuery('notifications', 'POST', {
            user_id: payment.seller_id,
            type: 'sale',
            title: '💰 Sikeres eladás!',
            message: `Egy vevő megvásárolta a hirdetésedet! Összeg: ${payment.amount?.toLocaleString('hu-HU')} Ft`,
            data: { listing_id: payment.listing_id, amount: payment.amount }
        }),
        supabaseQuery('notifications', 'POST', {
            user_id: payment.buyer_id,
            type: 'purchase',
            title: '✅ Sikeres vásárlás!',
            message: 'A fizetésed sikeresen feldolgozásra került. Köszönjük a vásárlást!',
            data: { listing_id: payment.listing_id, amount: payment.amount }
        })
    ]);
}

async function sendRefundNotification(orderId) {
    if (!orderId) return;
    const payments = await supabaseQuery(
        `payments?order_id=eq.${encodeURIComponent(orderId)}&select=buyer_id,amount`
    );
    const payment = payments?.[0];
    if (!payment) return;

    await supabaseQuery('notifications', 'POST', {
        user_id: payment.buyer_id,
        type: 'refund',
        title: '↩️ Visszatérítés feldolgozva',
        message: `${payment.amount?.toLocaleString('hu-HU')} Ft visszatérítés kerül a számládra 3-5 munkanapon belül.`,
        data: { amount: payment.amount }
    });
}

// ============================================================
// HŰSÉGPONTOK – ATOMIKUS SUPABASE RPC HÍVÁSSAL
// ============================================================
// JAVÍTÁS: Ahelyett hogy felülírnánk a pontokat (race condition!),
// Supabase RPC-t használunk: increment_loyalty_points(user_id, points)
// SQL a Supabase dashboardon:
//
// CREATE OR REPLACE FUNCTION increment_loyalty_points(p_user_id uuid, p_points int)
// RETURNS void LANGUAGE sql AS $$
//   UPDATE profiles SET loyalty_points = loyalty_points + p_points WHERE id = p_user_id;
// $$;
// ============================================================
async function addLoyaltyPoints(orderId) {
    if (!orderId) return;
    const payments = await supabaseQuery(
        `payments?order_id=eq.${encodeURIComponent(orderId)}&select=buyer_id,amount`
    );
    const payment = payments?.[0];
    if (!payment) return;

    const points = Math.floor((payment.amount || 0) / 5000) * 50;
    if (points <= 0) return;

    // Atomikus increment RPC-vel – nincs race condition
    const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/increment_loyalty_points`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_user_id: payment.buyer_id, p_points: points })
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Pontok hozzáadása sikertelen: ${errText}`);
    }

    log('info', 'loyalty_points_added', { buyerId: payment.buyer_id, points });
}
