// ============================================================
// PAYPAL FIZETÉSI EDGE FUNCTION
// Fájl helye: /api/paypal-payment.js
// ============================================================
//
// TELEPÍTÉS:
//   1. Másold be ezt a fájlt az /api/ mappába
//   Elérési út: https://SAJAT-DOMAIN.hu/api/paypal-payment
//
// ============================================================
//
// PAYPAL FIÓK BEÁLLÍTÁS:
//   1. Menj: https://developer.paypal.com
//   2. Log in → My Apps & Credentials
//   3. Kattints: Create App
//      - App name: bármi
//      - App type: Merchant
//   4. Kapsz:
//      - Client ID     (nyilvános)
//      - Client Secret (titkos!)
//   5. Éles módhoz: PayPal dashboard → Live credentials
//
// ============================================================
//
// KÖRNYEZETI VÁLTOZÓK – Vercel dashboard → Settings → Environment Variables:
//
//   PAYPAL_CLIENT_ID       = AaBbCc...
//   PAYPAL_CLIENT_SECRET   = EeFfGg...
//   PAYPAL_ENV             = "sandbox" fejlesztéshez  |  "live" éles üzemhez
//   PAYPAL_MERCHANT_EMAIL  = a PayPal-fiókhoz tartozó email (pl. paypal@sajatdomain.hu)
//   REFUND_SECRET          = egy erős egyedi jelszó visszatérítési hívásokhoz
//                            (generálás: openssl rand -hex 32)
//   NEXT_PUBLIC_SITE_URL   = https://SAJAT-DOMAIN.hu
//
// A REFUND_SECRET-et minden visszatérítési API híváskor el kell küldeni
// az Authorization fejlécben: Authorization: Bearer <REFUND_SECRET>
//
// ============================================================
//
// ✏️  MIT KELL ÁTÍRNI HA TOVÁBBADOM A RENDSZERT?
//
//   1. Vercel env változók (fent leírva) – állítsd be az új fiókban
//   2. A CORS sor (lejjebb jelölve)      – írd át az új domain-re
//   3. A brand_name sor (lejjebb jelölve) – írd át a cégnévre
//
// ============================================================


// ------------------------------------------------------------
// PAYPAL API URL – sandbox vagy live környezet alapján automatikus
// ------------------------------------------------------------
const PAYPAL_API = process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';


// ------------------------------------------------------------
// ✏️  CLIENT ID ÉS SECRET
// Ajánlott: Vercel env változókon keresztül töltődik be.
// Ha mégis hardcode-olni akarod, a fallback értéket ('YOUR_...')
// cseréld le a valódi adatokra.
// ------------------------------------------------------------
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'YOUR_PAYPAL_CLIENT_ID';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'YOUR_PAYPAL_CLIENT_SECRET';


// ------------------------------------------------------------
// FŐ HANDLER – minden kérés ide érkezik
// ------------------------------------------------------------
export default async function handler(req, res) {

    // ✏️  CORS – írd át az új domain-re (pl. 'https://ujvevo.hu')
    res.setHeader('Access-Control-Allow-Origin', 'https://SAJAT-DOMAIN.hu');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Preflight kérés kezelése (böngésző CORS ellenőrzés)
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Csak POST kérések engedélyezettek
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { action } = req.body;

        switch (action) {
            case 'create': return await createOrder(req, res);      // Rendelés létrehozása
            case 'capture': return await captureOrder(req, res);     // Fizetés véglegesítése
            case 'refund': return await refundOrder(req, res);      // Visszatérítés
            case 'details': return await getOrderDetails(req, res);  // Rendelés részletek
            default:
                return res.status(400).json({ error: 'Ismeretlen action. Lehetséges értékek: create | capture | refund | details' });
        }
    } catch (err) {
        console.error('PayPal hiba:', err);
        return res.status(500).json({ error: 'Szerver hiba', details: err.message });
    }
}


// ============================================================
// ACCESS TOKEN LEKÉRÉS (belső segédfüggvény)
// A PayPal minden API hívás előtt egy ideiglenes tokent igényel.
// ============================================================
async function getAccessToken() {
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    const data = await response.json();

    if (!data.access_token) {
        throw new Error('PayPal token lekérés sikertelen – ellenőrizd a CLIENT_ID és CLIENT_SECRET értékeket');
    }

    return data.access_token;
}


// ============================================================
// 1. RENDELÉS LÉTREHOZÁSA
// POST /api/paypal-payment  { action: "create", orderId, amount, ... }
// ============================================================
async function createOrder(req, res) {
    const {
        orderId,          // Egyedi rendelésazonosító a mi oldalunkról
        amount,           // Fizetendő összeg forintban – pozitív egész szám (pl. 4990)
        itemName,         // Termék neve (max 127 karakter)
        itemDescription,  // Termék leírása (opcionális, max 127 karakter)
        buyerEmail,       // Vevő email-címe (opcionális, PayPal előtölti)
        returnUrl,        // Sikeres fizetés után ide irányít a PayPal
        cancelUrl         // Megszakított fizetés után ide irányít a PayPal
    } = req.body;

    // --- Kötelező mezők ellenőrzése ---
    if (!amount || !itemName) {
        return res.status(400).json({ error: 'Hiányzó kötelező mezők: amount, itemName' });
    }

    // --- Összeg ellenőrzése ---
    if (typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
        return res.status(400).json({ error: 'Az amount pozitív egész szám kell legyen (pl. 4990)' });
    }

    const accessToken = await getAccessToken();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://SAJAT-DOMAIN.hu';
    const refId = orderId || 'ORDER_' + Date.now();
    const amountStr = String(amount); // HUF – egész szám, nincs tizedes

    const orderPayload = {
        intent: 'CAPTURE', // Azonnali fizetés (nem előre engedélyezett)
        purchase_units: [
            {
                reference_id: refId,
                description: itemDescription || itemName,
                custom_id: refId,
                amount: {
                    currency_code: 'HUF',
                    value: amountStr,
                    breakdown: {
                        item_total: { currency_code: 'HUF', value: amountStr }
                    }
                },
                items: [
                    {
                        name: itemName.substring(0, 127),
                        description: (itemDescription || '').substring(0, 127),
                        unit_amount: { currency_code: 'HUF', value: amountStr },
                        quantity: '1',
                        category: 'PHYSICAL_GOODS'
                    }
                ],
                payee: {
                    // Ki kapja a pénzt – a Vercel env változóból töltődik be
                    email_address: process.env.PAYPAL_MERCHANT_EMAIL || 'YOUR_PAYPAL_MERCHANT_EMAIL'
                }
            }
        ],

        // Opcionális: vevő email előtöltése a PayPal oldalon
        payer: buyerEmail ? { email_address: buyerEmail } : undefined,

        application_context: {
            // ✏️  brand_name – írd át a cégnévre (pl. 'UjCég')
            brand_name: 'SAJAT-CEG',
            locale: 'hu-HU',
            landing_page: 'BILLING',       // Rögtön a fizetési lapra visz
            shipping_preference: 'NO_SHIPPING',   // Nincs szállítási cím mező
            user_action: 'PAY_NOW',        // Gomb felirata: "Fizetés most"
            return_url: returnUrl || `${siteUrl}?payment=success`,
            cancel_url: cancelUrl || `${siteUrl}?payment=cancelled`
        }
    };

    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'PayPal-Request-Id': refId  // Idempotency kulcs – dupla küldést megakadályoz
        },
        body: JSON.stringify(orderPayload)
    });

    const data = await response.json();

    // --- PayPal hibák kezelése ---
    if (!data.id || data.name === 'INVALID_REQUEST') {
        console.error('PayPal rendelés hiba:', data);
        return res.status(400).json({ error: 'PayPal rendelés létrehozási hiba', details: data });
    }

    // A 'approve' linkre kell átirányítani a vevőt a PayPal fizetési oldalra
    const approveUrl = data.links?.find(l => l.rel === 'approve')?.href;

    return res.status(200).json({
        success: true,
        orderId: data.id,
        status: data.status,
        approveUrl: approveUrl, // ← ide irányítsd a felhasználót
        links: data.links
    });
}


// ============================================================
// 2. FIZETÉS VÉGLEGESÍTÉSE (CAPTURE)
// POST /api/paypal-payment  { action: "capture", paypalOrderId }
// Ezt kell hívni miután a vevő visszatér a PayPal oldaláról.
// ============================================================
async function captureOrder(req, res) {
    const { paypalOrderId } = req.body;

    if (!paypalOrderId) {
        return res.status(400).json({ error: 'paypalOrderId megadása kötelező' });
    }

    const accessToken = await getAccessToken();

    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${paypalOrderId}/capture`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    const data = await response.json();

    // --- Elutasított fizetési eszköz (pl. kártya limit) ---
    if (data.name === 'INSTRUMENT_DECLINED') {
        return res.status(400).json({ error: 'Fizetési eszköz elutasítva', details: data });
    }

    // --- Nem teljesült fizetés ---
    if (data.status !== 'COMPLETED') {
        return res.status(400).json({ error: 'Fizetés nem teljesült', status: data.status });
    }

    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];

    return res.status(200).json({
        success: true,
        orderId: data.id,
        status: 'paid',                                                          // ✅ Sikeres fizetés
        captureId: capture?.id,                                                     // Visszatérítéshez kell!
        amount: capture?.amount?.value,
        currency: capture?.amount?.currency_code,
        payerEmail: data.payer?.email_address,
        payerName: `${data.payer?.name?.given_name || ''} ${data.payer?.name?.surname || ''}`.trim(),
        completedAt: capture?.create_time
    });
}


// ============================================================
// 3. VISSZATÉRÍTÉS
// POST /api/paypal-payment  { action: "refund", captureId, amount, currency, note }
// Header: Authorization: Bearer <REFUND_SECRET>
// A captureId a captureOrder válaszából kapható.
// ============================================================
async function refundOrder(req, res) {

    // --- Jogosultság ellenőrzés ---
    // Csak az tudja hívni, aki ismeri a REFUND_SECRET értékét.
    // Ezt a Vercel env változóknál kell beállítani.
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${process.env.REFUND_SECRET}`) {
        return res.status(401).json({ error: 'Nem engedélyezett – érvénytelen vagy hiányzó REFUND_SECRET' });
    }

    const { captureId, amount, currency, note } = req.body;

    if (!captureId) {
        return res.status(400).json({ error: 'captureId megadása kötelező' });
    }

    const accessToken = await getAccessToken();

    // Ha nincs amount megadva, a teljes összeget téríti vissza
    const refundPayload = {};
    if (amount) {
        if (typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ error: 'Az amount pozitív szám kell legyen' });
        }
        refundPayload.amount = {
            value: String(amount),
            currency_code: currency || 'HUF'
        };
    }
    if (note) {
        refundPayload.note_to_payer = note.substring(0, 255);
    }

    const response = await fetch(`${PAYPAL_API}/v2/payments/captures/${captureId}/refund`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(refundPayload)
    });

    const data = await response.json();

    // --- PayPal hibák kezelése ---
    if (data.name) {
        return res.status(400).json({ error: 'Visszatérítési hiba', details: data });
    }

    return res.status(200).json({
        success: true,
        refundId: data.id,
        status: data.status,
        amount: data.amount?.value
    });
}


// ============================================================
// 4. RENDELÉS RÉSZLETEK LEKÉRDEZÉSE
// POST /api/paypal-payment  { action: "details", paypalOrderId }
// ============================================================
async function getOrderDetails(req, res) {
    const { paypalOrderId } = req.body;

    if (!paypalOrderId) {
        return res.status(400).json({ error: 'paypalOrderId megadása kötelező' });
    }

    const accessToken = await getAccessToken();

    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${paypalOrderId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = await response.json();

    if (data.name) {
        return res.status(400).json({ error: 'Rendelés lekérdezési hiba', details: data });
    }

    return res.status(200).json({ success: true, order: data });
}
