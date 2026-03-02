// ============================================================
// PIACTÉR – FIZETÉSI WEBHOOK HANDLER
// Fájl helye: /api/payment-webhook.js
// ============================================================
// Ez a fájl kezeli a Barion és PayPal visszahívásokat (webhook)
// amikor egy fizetés sikerül, meghiúsul vagy visszatérítés történik.
// Elérési út: https://piacter.hu/api/payment-webhook
// ============================================================
// BEÁLLÍTÁS:
// Vercel Environment Variables:
//   BARION_POS_KEY = a_te_poskeyed
//   PAYPAL_WEBHOOK_ID = a_paypal_webhook_id
//   SUPABASE_URL = https://xxx.supabase.co
//   SUPABASE_SERVICE_KEY = eyJ... (service_role key, NEM az anon!)
// ============================================================

import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BARION_POS_KEY = process.env.BARION_POS_KEY;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://piacter.hu';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    // Barion státusz callback (GET paraméterekkel)
    return await handleBarionCallback(req, res);
  }

  if (req.method === 'POST') {
    const source = req.headers['paypal-transmission-id'] ? 'paypal' : 'barion';
    if (source === 'paypal') return await handlePayPalWebhook(req, res);
    if (source === 'barion') return await handleBarionWebhook(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ============================================================
// BARION CALLBACK (GET – böngészőből jön)
// ============================================================
async function handleBarionCallback(req, res) {
  const { paymentId, orderId } = req.query;

  if (!paymentId) {
    return res.redirect(`${SITE_URL}?payment=error&reason=missing_payment_id`);
  }

  try {
    // Státusz lekérdezés a Barion API-tól
    const statusRes = await fetch(
      `https://api${process.env.BARION_ENV === 'prod' ? '' : '.test'}.barion.com/v2/Payment/GetPaymentState?POSKey=${BARION_POS_KEY}&PaymentId=${paymentId}`
    );
    const statusData = await statusRes.json();

    if (statusData.Status === 'Succeeded') {
      await updatePaymentStatus(orderId, 'paid', { barion_payment_id: paymentId });
      await markListingAsSold(orderId);
      await sendSuccessNotification(orderId);
      return res.redirect(`${SITE_URL}?payment=success&orderId=${orderId}`);
    } else if (statusData.Status === 'Failed' || statusData.Status === 'Canceled') {
      await updatePaymentStatus(orderId, 'failed', { barion_payment_id: paymentId });
      return res.redirect(`${SITE_URL}?payment=failed&orderId=${orderId}`);
    } else {
      return res.redirect(`${SITE_URL}?payment=pending&orderId=${orderId}&paymentId=${paymentId}`);
    }
  } catch (err) {
    console.error('Barion callback hiba:', err);
    return res.redirect(`${SITE_URL}?payment=error`);
  }
}

// ============================================================
// BARION WEBHOOK (POST – szerver oldalról jön)
// ============================================================
async function handleBarionWebhook(req, res) {
  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId hiányzik' });

  try {
    const statusRes = await fetch(
      `https://api${process.env.BARION_ENV === 'prod' ? '' : '.test'}.barion.com/v2/Payment/GetPaymentState?POSKey=${BARION_POS_KEY}&PaymentId=${paymentId}`
    );
    const statusData = await statusRes.json();

    // Rendelés azonosító keresés
    const orderId = statusData.OrderNumber || statusData.Transactions?.[0]?.POSTransactionId?.replace('_1', '');

    if (statusData.Status === 'Succeeded') {
      await updatePaymentStatus(orderId, 'paid', {
        barion_payment_id: paymentId,
        transaction_id: statusData.Transactions?.[0]?.TransactionId
      });
      await markListingAsSold(orderId);
      await sendSuccessNotification(orderId);
      await addLoyaltyPoints(orderId);
    } else if (statusData.Status === 'Failed') {
      await updatePaymentStatus(orderId, 'failed', { barion_payment_id: paymentId });
    } else if (statusData.Status === 'Refunded') {
      await updatePaymentStatus(orderId, 'refunded', { barion_payment_id: paymentId });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Barion webhook hiba:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ============================================================
// PAYPAL WEBHOOK (POST)
// ============================================================
async function handlePayPalWebhook(req, res) {
  // PayPal webhook aláírás ellenőrzés
  const isValid = await verifyPayPalWebhook(req);
  if (!isValid) {
    console.error('PayPal webhook aláírás érvénytelen!');
    return res.status(401).json({ error: 'Érvénytelen webhook aláírás' });
  }

  const { event_type, resource } = req.body;
  console.log('PayPal webhook esemény:', event_type);

  switch (event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const orderId = resource.custom_id || resource.purchase_units?.[0]?.custom_id;
      await updatePaymentStatus(orderId, 'paid', {
        paypal_order_id: resource.id,
        transaction_id: resource.id
      });
      await markListingAsSold(orderId);
      await sendSuccessNotification(orderId);
      await addLoyaltyPoints(orderId);
      break;
    }
    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED': {
      const orderId = resource.custom_id;
      await updatePaymentStatus(orderId, 'failed', { paypal_order_id: resource.id });
      break;
    }
    case 'PAYMENT.CAPTURE.REFUNDED': {
      const orderId = resource.custom_id;
      await updatePaymentStatus(orderId, 'refunded', { paypal_order_id: resource.id });
      await sendRefundNotification(orderId);
      break;
    }
    case 'CHECKOUT.ORDER.APPROVED': {
      console.log('PayPal rendelés jóváhagyva:', resource.id);
      break;
    }
  }

  return res.status(200).json({ success: true });
}

// ============================================================
// PAYPAL WEBHOOK ALÁÍRÁS ELLENŐRZÉS
// ============================================================
async function verifyPayPalWebhook(req) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return true; // fejlesztési módban átugorjuk

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

    const response = await fetch(`${apiUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(verifyPayload)
    });

    const data = await response.json();
    return data.verification_status === 'SUCCESS';
  } catch {
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

  const res = await fetch(`${apiUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return data.access_token;
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
  return res.json();
}

async function updatePaymentStatus(orderId, status, extra = {}) {
  if (!orderId) return;
  await supabaseQuery(
    `payments?order_id=eq.${orderId}`,
    'PATCH',
    { status, updated_at: new Date().toISOString(), ...extra }
  );
  console.log(`Fizetés státusz frissítve: ${orderId} → ${status}`);
}

async function markListingAsSold(orderId) {
  if (!orderId) return;
  // Fizetésből listing_id lekérés
  const payments = await supabaseQuery(`payments?order_id=eq.${orderId}&select=listing_id,seller_id`);
  const payment = payments?.[0];
  if (!payment?.listing_id) return;

  await supabaseQuery(
    `listings?id=eq.${payment.listing_id}`,
    'PATCH',
    { status: 'sold', updated_at: new Date().toISOString() }
  );
  console.log('Hirdetés eladottnak jelölve:', payment.listing_id);
}

async function sendSuccessNotification(orderId) {
  if (!orderId) return;
  const payments = await supabaseQuery(`payments?order_id=eq.${orderId}&select=seller_id,buyer_id,amount,listing_id`);
  const payment = payments?.[0];
  if (!payment) return;

  // Értesítés az eladónak
  await supabaseQuery('notifications', 'POST', {
    user_id: payment.seller_id,
    type: 'sale',
    title: '💰 Sikeres eladás!',
    message: `Egy vevő megvásárolta a hirdetésedet! Összeg: ${payment.amount?.toLocaleString('hu-HU')} Ft`,
    data: { listing_id: payment.listing_id, amount: payment.amount }
  });

  // Értesítés a vevőnek
  await supabaseQuery('notifications', 'POST', {
    user_id: payment.buyer_id,
    type: 'purchase',
    title: '✅ Sikeres vásárlás!',
    message: `A fizetésed sikeresen feldolgozásra került. Köszönjük a vásárlást!`,
    data: { listing_id: payment.listing_id, amount: payment.amount }
  });
}

async function sendRefundNotification(orderId) {
  if (!orderId) return;
  const payments = await supabaseQuery(`payments?order_id=eq.${orderId}&select=buyer_id,amount`);
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

async function addLoyaltyPoints(orderId) {
  if (!orderId) return;
  const payments = await supabaseQuery(`payments?order_id=eq.${orderId}&select=buyer_id,amount`);
  const payment = payments?.[0];
  if (!payment) return;

  // Pontok: 50 pont minden 5000 Ft után
  const points = Math.floor((payment.amount || 0) / 5000) * 50;
  if (points > 0) {
    await supabaseQuery(
      `profiles?id=eq.${payment.buyer_id}`,
      'PATCH',
      { loyalty_points: points } // Supabase RPC-vel kellene, de egyszerűsítve
    );
  }
}
