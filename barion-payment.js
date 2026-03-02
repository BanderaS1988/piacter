// ============================================================
// PIACTÉR – BARION FIZETÉSI EDGE FUNCTION
// Fájl helye: /api/barion-payment.js
// ============================================================
// TELEPÍTÉS:
// 1. Hozz létre egy /api/ mappát a projekt gyökerében
// 2. Másold be ezt a fájlt
// 3. Vercel automatikusan felismeri és API végpontként kezeli
// Elérési út: https://piacter.hu/api/barion-payment
// ============================================================
// BARION FIÓK BEÁLLÍTÁS:
// 1. Menj: https://barion.com → Regisztrálj
// 2. Barion dashboard → Fizetési megoldások → Új POS
// 3. POS neve: PiacTér, Pénznem: HUF
// 4. Kapsz egy POSkey-t (pl. a1b2c3d4e5f6...)
// 5. Vercel dashboard → Settings → Environment Variables:
//    BARION_POS_KEY = a_te_poskeyed
//    BARION_PAYEE_EMAIL = barion@piacter.hu
//    BARION_ENV = test  (élesben: prod)
// ============================================================

const BARION_API = process.env.BARION_ENV === 'prod'
  ? 'https://api.barion.com'
  : 'https://api.test.barion.com';

const POS_KEY = process.env.BARION_POS_KEY || 'YOUR_BARION_POS_KEY';
const PAYEE_EMAIL = process.env.BARION_PAYEE_EMAIL || 'YOUR_BARION_EMAIL';

export default async function handler(req, res) {
  // CORS fejlécek
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action } = req.body;

    switch (action) {
      case 'start':       return await startPayment(req, res);
      case 'status':      return await getPaymentStatus(req, res);
      case 'refund':      return await refundPayment(req, res);
      default:            return res.status(400).json({ error: 'Ismeretlen action' });
    }
  } catch (err) {
    console.error('Barion hiba:', err);
    return res.status(500).json({ error: 'Szerver hiba', details: err.message });
  }
}

// ============================================================
// FIZETÉS INDÍTÁSA
// ============================================================
async function startPayment(req, res) {
  const {
    orderId,        // egyedi rendelés azonosító
    amount,         // összeg forintban (egész szám)
    buyerEmail,     // vevő email
    itemName,       // termék neve
    itemDescription,// termék leírása
    redirectUrl,    // sikeres fizetés után ide irányít
    callbackUrl     // webhook URL (fizetés visszaigazoláshoz)
  } = req.body;

  if (!orderId || !amount || !itemName) {
    return res.status(400).json({ error: 'Hiányzó kötelező mezők: orderId, amount, itemName' });
  }

  const paymentPayload = {
    POSKey: POS_KEY,
    PaymentType: 'Immediate',
    PaymentWindow: '00:30:00',        // 30 perc fizetési ablak
    GuestCheckout: true,              // vendég checkout engedélyezve
    FundingSources: ['All'],          // minden fizetési mód
    PaymentRequestId: orderId,
    PayerHint: buyerEmail || '',
    Locale: 'hu-HU',
    Currency: 'HUF',
    OrderNumber: orderId,
    ShippingAddress: null,
    Transactions: [
      {
        POSTransactionId: orderId + '_1',
        Payee: PAYEE_EMAIL,
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
    RedirectUrl: redirectUrl || `${process.env.NEXT_PUBLIC_SITE_URL || 'https://piacter.hu'}?payment=success&orderId=${orderId}`,
    CallbackUrl: callbackUrl || `${process.env.NEXT_PUBLIC_SITE_URL || 'https://piacter.hu'}/api/payment-webhook`
  };

  const response = await fetch(`${BARION_API}/v2/Payment/Start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentPayload)
  });

  const data = await response.json();

  if (data.Errors && data.Errors.length > 0) {
    console.error('Barion API hiba:', data.Errors);
    return res.status(400).json({
      error: 'Barion fizetés indítási hiba',
      errors: data.Errors.map(e => e.Description)
    });
  }

  return res.status(200).json({
    success: true,
    paymentId: data.PaymentId,
    status: data.Status,
    // Ez az URL ahova a felhasználót át kell irányítani
    redirectUrl: `https://secure${process.env.BARION_ENV === 'prod' ? '' : '.test'}.barion.com/Pay?id=${data.PaymentId}`,
    gatewayUrl: data.GatewayUrl
  });
}

// ============================================================
// FIZETÉS STÁTUSZ LEKÉRDEZÉS
// ============================================================
async function getPaymentStatus(req, res) {
  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId szükséges' });

  const response = await fetch(
    `${BARION_API}/v2/Payment/GetPaymentState?POSKey=${POS_KEY}&PaymentId=${paymentId}`,
    { method: 'GET' }
  );

  const data = await response.json();

  if (data.Errors && data.Errors.length > 0) {
    return res.status(400).json({ error: 'Státusz lekérdezési hiba', errors: data.Errors });
  }

  const statusMap = {
    'Prepared':   'pending',
    'Started':    'pending',
    'InProgress': 'pending',
    'Waiting':    'pending',
    'Reserved':   'pending',
    'Authorized': 'authorized',
    'Succeeded':  'paid',
    'Failed':     'failed',
    'PartiallySucceeded': 'partial',
    'Expired':    'expired',
    'Canceled':   'cancelled'
  };

  return res.status(200).json({
    success: true,
    paymentId: data.PaymentId,
    status: statusMap[data.Status] || data.Status,
    rawStatus: data.Status,
    total: data.Transactions?.[0]?.Total,
    payerEmail: data.PayerEmail,
    completedAt: data.CompletedAt,
    transactions: data.Transactions
  });
}

// ============================================================
// VISSZATÉRÍTÉS
// ============================================================
async function refundPayment(req, res) {
  const { paymentId, transactionId, amount, comment } = req.body;
  if (!paymentId || !transactionId || !amount) {
    return res.status(400).json({ error: 'paymentId, transactionId és amount szükséges' });
  }

  const refundPayload = {
    POSKey: POS_KEY,
    PaymentId: paymentId,
    TransactionsToRefund: [
      {
        POSTransactionId: transactionId + '_refund_' + Date.now(),
        OriginalTransactionId: transactionId,
        AmountToRefund: amount,
        Comment: comment || 'Visszatérítés – PiacTér'
      }
    ]
  };

  const response = await fetch(`${BARION_API}/v2/Payment/Refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refundPayload)
  });

  const data = await response.json();

  if (data.Errors && data.Errors.length > 0) {
    return res.status(400).json({ error: 'Visszatérítési hiba', errors: data.Errors });
  }

  return res.status(200).json({ success: true, refundedTransactions: data.RefundedTransactions });
}
