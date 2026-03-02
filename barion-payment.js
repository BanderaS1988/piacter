// ============================================================
// BARION FIZETÉSI EDGE FUNCTION
// Fájl helye: /api/barion-payment.js
// ============================================================
//
// TELEPÍTÉS:
//   1. Hozz létre egy /api/ mappát a projekt gyökerében
//   2. Másold be ezt a fájlt
//   3. Vercel automatikusan felismeri és API végpontként kezeli
//   Elérési út: https://SAJAT-DOMAIN.hu/api/barion-payment
//
// ============================================================
//
// BARION FIÓK BEÁLLÍTÁS:
//   1. Menj: https://barion.com → Regisztrálj
//   2. Barion dashboard → Fizetési megoldások → Új POS
//   3. POS neve: bármi, Pénznem: HUF
//   4. Kapsz egy POSKey-t (pl. a1b2c3d4e5f6...)
//
// ============================================================
//
// KÖRNYEZETI VÁLTOZÓK – Vercel dashboard → Settings → Environment Variables:
//
//   BARION_POS_KEY        = a Barion dashboardon kapott POSKey
//   BARION_PAYEE_EMAIL    = a Barion-fiókhoz tartozó email (pl. barion@sajatdomain.hu)
//   BARION_ENV            = "test" fejlesztéshez  |  "prod" éles üzemhez
//   REFUND_SECRET         = egy erős egyedi jelszó visszatérítési hívásokhoz
//                           (generálás: openssl rand -hex 32)
//   NEXT_PUBLIC_SITE_URL  = https://SAJAT-DOMAIN.hu
//
// A REFUND_SECRET-et minden visszatérítési API híváskor el kell küldeni
// az Authorization fejlécben: Authorization: Bearer <REFUND_SECRET>
//
// ============================================================
//
// ✏️  MIT KELL ÁTÍRNI HA TOVÁBBADOM A RENDSZERT?
//
//   1. Vercel env változók (fent leírva) – ezeket állítsd be az új fiókban
//   2. A CORS sor (lejjebb jelölve) – írd át az új domain-re
//   3. A visszatérítés kommentje (lejjebb jelölve) – írd át a cégnévre
//
// ============================================================


// ------------------------------------------------------------
// BARION API URL – test vagy prod környezet alapján automatikus
// ------------------------------------------------------------
const BARION_API = process.env.BARION_ENV === 'prod'
    ? 'https://api.barion.com'
    : 'https://api.test.barion.com';


// ------------------------------------------------------------
// ✏️  POS KULCS ÉS EMAIL
// Ajánlott: Vercel env változókon keresztül töltődik be.
// Ha mégis hardcode-olni akarod, a fallback értéket ('YOUR_...')
// cseréld le a valódi adatokra.
// ------------------------------------------------------------
const POS_KEY = process.env.BARION_POS_KEY || 'YOUR_BARION_POS_KEY';
const PAYEE_EMAIL = process.env.BARION_PAYEE_EMAIL || 'YOUR_BARION_EMAIL';


// ------------------------------------------------------------
// FETCH IDŐKORLÁTTAL
// Ha a Barion API 8 másodpercen belül nem válaszol, megszakítja a kérést.
// ------------------------------------------------------------
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}


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
            case 'start': return await startPayment(req, res);   // Fizetés indítása
            case 'status': return await getPaymentStatus(req, res); // Státusz lekérdezés
            case 'refund': return await refundPayment(req, res);   // Visszatérítés
            default:
                return res.status(400).json({ error: 'Ismeretlen action. Lehetséges értékek: start | status | refund' });
        }
    } catch (err) {
        console.error('Barion hiba:', err);
        return res.status(500).json({ error: 'Szerver hiba', details: err.message });
    }
}


// ============================================================
// 1. FIZETÉS INDÍTÁSA
// POST /api/barion-payment  { action: "start", orderId, amount, ... }
// ============================================================
async function startPayment(req, res) {
    const {
        orderId,          // Egyedi rendelésazonosító (UUID vagy ORDER_<timestamp> formátum)
        amount,           // Fizetendő összeg forintban – pozitív egész szám (pl. 4990)
        buyerEmail,       // Vevő email-címe (opcionális, Barion előtölti a mezőt)
        itemName,         // Termék neve (max 250 karakter)
        itemDescription,  // Termék leírása (opcionális, max 500 karakter)
        redirectUrl,      // Sikeres fizetés után ide irányít a Barion
        callbackUrl       // Webhook URL – ide küld visszaigazolást a Barion
    } = req.body;

    // --- Kötelező mezők ellenőrzése ---
    if (!orderId || !amount || !itemName) {
        return res.status(400).json({
            error: 'Hiányzó kötelező mezők: orderId, amount, itemName'
        });
    }

    // --- orderId formátum ellenőrzése (UUID v4 vagy ORDER_<timestamp>) ---
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);
    const isOrderFormat = /^ORDER_\d{10,15}$/.test(orderId);
    if (!isUUID && !isOrderFormat) {
        return res.status(400).json({
            error: 'Érvénytelen orderId formátum. Fogadott: UUID v4 vagy ORDER_<timestamp>'
        });
    }

    // --- Összeg ellenőrzése ---
    if (typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
        return res.status(400).json({
            error: 'Az amount pozitív egész szám kell legyen (pl. 4990)'
        });
    }

    // --- Barion fizetési kérés összeállítása ---
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://SAJAT-DOMAIN.hu';

    const paymentPayload = {
        POSKey: POS_KEY,
        PaymentType: 'Immediate',       // Azonnali fizetés (nem előre engedélyezett)
        PaymentWindow: '00:30:00',        // 30 perc az ügyfélnek a fizetésre
        GuestCheckout: true,              // Barion-fiók nélkül is lehet fizetni
        FundingSources: ['All'],           // Minden fizetési mód engedélyezett
        PaymentRequestId: orderId,          // Egyedi azonosító a mi oldalunkról
        PayerHint: buyerEmail || '',  // Barion előtölti az email mezőt
        Locale: 'hu-HU',
        Currency: 'HUF',
        OrderNumber: orderId,

        Transactions: [
            {
                POSTransactionId: orderId + '_1',   // Egyedi tranzakció ID
                Payee: PAYEE_EMAIL,       // Ki kapja a pénzt
                Total: amount,
                Comment: itemDescription || itemName,
                Items: [
                    {
                        Name: itemName.substring(0, 250),
                        Description: (itemDescription || itemName).substring(0, 500),
                        Quantity: 1,
                        Unit: 'db',
                        UnitPrice: amount,
                        ItemTotal: amount,
                        SKU: orderId
                    }
                ]
            }
        ],

        // Sikeres fizetés után ide irányít a Barion
        RedirectUrl: redirectUrl
            || `${siteUrl}?payment=success&orderId=${orderId}`,

        // Barion ide küld POST értesítést, amikor megváltozik a fizetés státusza
        CallbackUrl: callbackUrl
            || `${siteUrl}/api/payment-webhook`
    };

    // --- API hívás ---
    const response = await fetchWithTimeout(`${BARION_API}/v2/Payment/Start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentPayload)
    });

    const data = await response.json();

    // --- Barion hibák kezelése ---
    if (data.Errors && data.Errors.length > 0) {
        console.error('Barion API hiba:', data.Errors);
        return res.status(400).json({
            error: 'Barion fizetés indítási hiba',
            errors: data.Errors.map(e => e.Description)
        });
    }

    // --- Sikeres válasz ---
    const isTest = process.env.BARION_ENV !== 'prod';
    return res.status(200).json({
        success: true,
        paymentId: data.PaymentId,
        status: data.Status,
        // Erre az URL-re kell átirányítani a vevőt a fizetési oldalra
        redirectUrl: `https://secure${isTest ? '.test' : ''}.barion.com/Pay?id=${data.PaymentId}`,
        gatewayUrl: data.GatewayUrl
    });
}


// ============================================================
// 2. FIZETÉS STÁTUSZ LEKÉRDEZÉS
// POST /api/barion-payment  { action: "status", paymentId }
// ============================================================
async function getPaymentStatus(req, res) {
    const { paymentId } = req.body;

    if (!paymentId) {
        return res.status(400).json({ error: 'paymentId megadása kötelező' });
    }

    // GET kérés a Barion felé
    const response = await fetchWithTimeout(
        `${BARION_API}/v2/Payment/GetPaymentState?POSKey=${POS_KEY}&PaymentId=${paymentId}`,
        { method: 'GET' }
    );

    const data = await response.json();

    if (data.Errors && data.Errors.length > 0) {
        return res.status(400).json({
            error: 'Státusz lekérdezési hiba',
            errors: data.Errors
        });
    }

    // Barion státuszok lefordítása belső státuszokra
    const statusMap = {
        'Prepared': 'pending',    // Előkészítve, de még nem nyitotta meg az ügyfél
        'Started': 'pending',    // Megnyitotta az ügyfél, még nem fizetett
        'InProgress': 'pending',    // Fizetés folyamatban
        'Waiting': 'pending',    // Várakozás (pl. banki jóváhagyásra)
        'Reserved': 'pending',    // Lefoglalt összeg, még nem teljesített
        'Authorized': 'authorized', // Engedélyezett, de még nem elszámolt
        'Succeeded': 'paid',       // ✅ Sikeres fizetés
        'Failed': 'failed',     // ❌ Sikertelen fizetés
        'PartiallySucceeded': 'partial',    // Részlegesen sikeres
        'Expired': 'expired',    // Lejárt a fizetési ablak
        'Canceled': 'cancelled'   // Ügyfél visszavonta
    };

    return res.status(200).json({
        success: true,
        paymentId: data.PaymentId,
        status: statusMap[data.Status] || data.Status, // Lefordított státusz
        rawStatus: data.Status,                           // Eredeti Barion státusz
        total: data.Transactions?.[0]?.Total,         // Fizetett összeg
        payerEmail: data.PayerEmail,                       // Fizető email-címe
        completedAt: data.CompletedAt,                      // Mikor fejeződött be
        transactions: data.Transactions                      // Teljes tranzakció lista
    });
}


// ============================================================
// 3. VISSZATÉRÍTÉS
// POST /api/barion-payment  { action: "refund", paymentId, transactionId, amount, comment }
// Header: Authorization: Bearer <REFUND_SECRET>
// ============================================================
async function refundPayment(req, res) {

    // --- Jogosultság ellenőrzés ---
    // Csak az tudja hívni, aki ismeri a REFUND_SECRET értékét.
    // Ezt a Vercel env változóknál kell beállítani.
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${process.env.REFUND_SECRET}`) {
        return res.status(401).json({ error: 'Nem engedélyezett – érvénytelen vagy hiányzó REFUND_SECRET' });
    }

    const { paymentId, transactionId, amount, comment } = req.body;

    if (!paymentId || !transactionId || !amount) {
        return res.status(400).json({
            error: 'Kötelező mezők: paymentId, transactionId, amount'
        });
    }

    const refundPayload = {
        POSKey: POS_KEY,
        PaymentId: paymentId,
        TransactionsToRefund: [
            {
                // Egyedi azonosító a visszatérítési tranzakciónak
                POSTransactionId: transactionId + '_refund_' + Date.now(),
                OriginalTransactionId: transactionId,  // Az eredeti tranzakció ID
                AmountToRefund: amount,
                // ✏️  Írd át a cégnévre (pl. 'Visszatérítés – SajátCég')
                Comment: comment || 'Visszatérítés – SAJAT-CEG'
            }
        ]
    };

    const response = await fetchWithTimeout(`${BARION_API}/v2/Payment/Refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refundPayload)
    });

    const data = await response.json();

    if (data.Errors && data.Errors.length > 0) {
        return res.status(400).json({
            error: 'Visszatérítési hiba',
            errors: data.Errors
        });
    }

    return res.status(200).json({
        success: true,
        refundedTransactions: data.RefundedTransactions
    });
}
