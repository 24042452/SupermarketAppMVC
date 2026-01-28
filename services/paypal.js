require('dotenv').config();

const getFetch = () => {
  if (typeof fetch === 'function') return fetch;
  // Fallback for older Node versions that don't have global fetch
  return (...args) => import('node-fetch').then(({ default: nodeFetch }) => nodeFetch(...args));
};

const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API;

async function getAccessToken() {
  const fetch = getFetch();
  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(PAYPAL_CLIENT + ':' + PAYPAL_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json();
  return data.access_token;
}

async function createOrder(amount) {
  const fetch = getFetch();
  const accessToken = await getAccessToken();
  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'SGD',
          value: amount
        }
      }]
    })
  });
  return await response.json();
}

async function captureOrder(orderId) {
  const fetch = getFetch();
  const accessToken = await getAccessToken();
  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const data = await response.json();
  console.log('PayPal captureOrder response:', data);
  return data;
}

async function refundCapture(captureId, amount) {
  const fetch = getFetch();
  const accessToken = await getAccessToken();
  const body = amount ? {
    amount: {
      value: Number(amount).toFixed(2),
      currency_code: 'SGD'
    }
  } : {};

  const response = await fetch(`${PAYPAL_API}/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  console.log('PayPal refundCapture response:', data);
  return { ok: response.ok, data };
}

module.exports = { createOrder, captureOrder, refundCapture };
