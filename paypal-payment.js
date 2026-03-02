// ============================================================
// PIACTÉR – PAYPAL FIZETÉSI EDGE FUNCTION
// Fájl helye: /api/paypal-payment.js
// ============================================================
// TELEPÍTÉS:
// 1. Másold be ezt a fájlt az /api/ mappába
// Elérési út: https://piacter.hu/api/paypal-payment
// ============================================================
// PAYPAL FIÓK BEÁLLÍTÁS:
// 1. Menj: https://developer.paypal.com
// 2. Log in → My Apps & Credentials
// 3. Kattints: Create App
//    - App name: PiacTér
//    - App type: Merchant
// 4. Kapsz:
//    - Client ID  (nyilvános)
//    - Client Secret (titkos!)
// 5. Vercel dashboard → Settings → Environment Variables:
//    PAYPAL_CLIENT_ID = AaBbCc...
//    PAYPAL_CLIENT_SECRET = EeFfGg...
//    PAYPAL_ENV = sandbox  (élesben: live)
// 6. Éles módhoz: PayPal dashboard → Live credentials
// ============================================================

const PAYPAL_API = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'YOUR_PAYPAL_CLIENT_ID';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'YOUR_PAYPAL_CLIENT_SECRET';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action } = req.body;
    switch (action) {
      case 'create':   return await createOrder(req, res);
      case 'capture':  return await captureOrder(req, res);
      case 'refund':   return await refundOrder(req, res);
      case 'details':  return await getOrderDetails(req, res);
      default:         return res.status(400).json({ error: 'Ismeretlen action' });
    }
  } catch (err) {
    console.error('PayPal hiba:', err);
    return res.status(500).json({ error: 'Szerver hiba', details: err.message });
  }
}

// ============================================================
// ACCESS TOKEN LEKÉRÉS
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
  if (!data.access_token) throw new Error('PayPal token lekérés sikertelen');
  return data.access_token;
}

// ============================================================
// RENDELÉS LÉTREHOZÁSA
// ============================================================
async function createOrder(req, res) {
  const {
    orderId,
    amount,         // forintban
    itemName,
    itemDescription,
    buyerEmail,
    returnUrl,
    cancelUrl
  } = req.body;

  if (!amount || !itemName) {
    return res.status(400).json({ error: 'amount és itemName szükséges' });
  }

  const accessToken = await getAccessToken();

  // PayPal HUF-ot is támogat
  const amountStr = (amount / 1).toFixed(0); // HUF egész szám

  const orderPayload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: orderId || 'ORDER_' + Date.now(),
        description: itemDescription || itemName,
        custom_id: orderId,
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
          email_address: process.env.PAYPAL_MERCHANT_EMAIL || 'merchant@piacter.hu'
        }
      }
    ],
    payer: buyerEmail ? { email_address: buyerEmail } : undefined,
    application_context: {
      brand_name: 'PiacTér',
      locale: 'hu-HU',
      landing_page: 'BILLING',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: returnUrl || `${process.env.NEXT_PUBLIC_SITE_URL || 'https://piacter.hu'}?payment=success`,
      cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_SITE_URL || 'https://piacter.hu'}?payment=cancelled`
    }
  };

  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': orderId || 'req_' + Date.now()
    },
    body: JSON.stringify(orderPayload)
  });

  const data = await response.json();

  if (data.name === 'INVALID_REQUEST' || !data.id) {
    console.error('PayPal rendelés hiba:', data);
    return res.status(400).json({ error: 'PayPal rendelés létrehozási hiba', details: data });
  }

  // Jóváhagyó URL keresés
  const approveLink = data.links?.find(l => l.rel === 'approve')?.href;

  return res.status(200).json({
    success: true,
    orderId: data.id,
    status: data.status,
    approveUrl: approveLink, // ide irányítsd a felhasználót
    links: data.links
  });
}

// ============================================================
// FIZETÉS VÉGLEGESÍTÉSE (CAPTURE)
// ============================================================
async function captureOrder(req, res) {
  const { paypalOrderId } = req.body;
  if (!paypalOrderId) return res.status(400).json({ error: 'paypalOrderId szükséges' });

  const accessToken = await getAccessToken();

  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();

  if (data.name === 'INSTRUMENT_DECLINED') {
    return res.status(400).json({ error: 'Fizetési eszköz elutasítva', details: data });
  }

  if (data.status !== 'COMPLETED') {
    return res.status(400).json({ error: 'Fizetés nem teljesült', status: data.status });
  }

  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];

  return res.status(200).json({
    success: true,
    orderId: data.id,
    status: 'paid',
    captureId: capture?.id,
    amount: capture?.amount?.value,
    currency: capture?.amount?.currency_code,
    payerEmail: data.payer?.email_address,
    payerName: data.payer?.name?.given_name + ' ' + data.payer?.name?.surname,
    completedAt: capture?.create_time
  });
}

// ============================================================
// VISSZATÉRÍTÉS
// ============================================================
async function refundOrder(req, res) {
  const { captureId, amount, currency, note } = req.body;
  if (!captureId) return res.status(400).json({ error: 'captureId szükséges' });

  const accessToken = await getAccessToken();

  const refundPayload = {};
  if (amount) {
    refundPayload.amount = {
      value: amount.toString(),
      currency_code: currency || 'HUF'
    };
  }
  if (note) refundPayload.note_to_payer = note.substring(0, 255);

  const response = await fetch(`${PAYPAL_API}/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(refundPayload)
  });

  const data = await response.json();

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
// RENDELÉS RÉSZLETEK
// ============================================================
async function getOrderDetails(req, res) {
  const { paypalOrderId } = req.body;
  if (!paypalOrderId) return res.status(400).json({ error: 'paypalOrderId szükséges' });

  const accessToken = await getAccessToken();

  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${paypalOrderId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  const data = await response.json();
  return res.status(200).json({ success: true, order: data });
}
