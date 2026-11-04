import crypto from 'node:crypto';

/**
 * M-Pesa STK Push ("Lipa na M-Pesa Online") via Safaricom's Daraja API.
 * The customer gets a PIN prompt on their phone; Safaricom then calls our callback with the result.
 *
 * Enabled only when Daraja credentials are configured (see .env.example). Returns null otherwise.
 */
export function createMpesa(env = process.env, { fetchImpl = fetch } = {}) {
  const cfg = {
    consumerKey: env.MPESA_CONSUMER_KEY,
    consumerSecret: env.MPESA_CONSUMER_SECRET,
    shortcode: env.MPESA_SHORTCODE,
    passkey: env.MPESA_PASSKEY,
    type: (env.MPESA_TYPE || 'paybill').toLowerCase(), // paybill | till
    tillNumber: env.MPESA_TILL_NUMBER,
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    baseUrl: env.MPESA_BASE_URL || (env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'),
  };
  if (!cfg.consumerKey || !cfg.consumerSecret || !cfg.shortcode || !cfg.passkey || !cfg.publicUrl) return null;

  // Secret path segment so only Safaricom (who we give the URL to) can post results.
  const callbackSecret = crypto.createHash('sha256').update(`${cfg.consumerSecret}:luxe-callback`).digest('hex').slice(0, 32);
  const callbackUrl = `${cfg.publicUrl}/api/mpesa/callback/${callbackSecret}`;

  let token = null;
  let tokenExpires = 0;

  async function accessToken() {
    if (token && Date.now() < tokenExpires) return token;
    const auth = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
    const res = await fetchImpl(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error('Could not connect to M-Pesa. Please pay via Paybill instead.');
    token = data.access_token;
    tokenExpires = Date.now() + (Number(data.expires_in || 3599) - 60) * 1000;
    return token;
  }

  // Daraja timestamps are YYYYMMDDHHmmss; we use Nairobi time.
  const timestamp = () => new Date(Date.now() + 3 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 14);

  return {
    callbackSecret,
    callbackUrl,

    /** Sends the PIN prompt. `phone` must be a Kenyan number in 07/01 form (from normalizePhone). */
    async stkPush({ phone, amount, accountReference, description }) {
      const msisdn = `254${phone.slice(1)}`;
      const ts = timestamp();
      const body = {
        BusinessShortCode: cfg.shortcode,
        Password: Buffer.from(`${cfg.shortcode}${cfg.passkey}${ts}`).toString('base64'),
        Timestamp: ts,
        TransactionType: cfg.type === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: msisdn,
        PartyB: cfg.type === 'till' ? (cfg.tillNumber || cfg.shortcode) : cfg.shortcode,
        PhoneNumber: msisdn,
        CallBackURL: callbackUrl,
        AccountReference: String(accountReference).slice(0, 12),
        TransactionDesc: String(description).slice(0, 13),
      };
      const res = await fetchImpl(`${cfg.baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || String(data.ResponseCode) !== '0' || !data.CheckoutRequestID) {
        throw new Error(data.errorMessage || data.ResponseDescription || 'M-Pesa could not send the prompt. Please try again or pay via Paybill.');
      }
      return { checkoutRequestId: data.CheckoutRequestID, customerMessage: data.CustomerMessage };
    },
  };
}

/** Reads Safaricom's STK callback payload into a simple shape. */
export function parseStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return null;
  const meta = Object.fromEntries((cb.CallbackMetadata?.Item || []).map((i) => [i.Name, i.Value]));
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    success: Number(cb.ResultCode) === 0,
    resultCode: Number(cb.ResultCode),
    message: cb.ResultDesc || '',
    amount: Number(meta.Amount || 0),
    receipt: meta.MpesaReceiptNumber ? String(meta.MpesaReceiptNumber) : null,
  };
}

/** Friendlier wording for the common failure codes. */
export function stkFailureMessage(code, fallback) {
  return {
    1: 'Your M-Pesa balance was too low for this payment.',
    1032: 'You cancelled the M-Pesa prompt.',
    1037: 'The prompt timed out before a PIN was entered.',
    2001: 'The M-Pesa PIN entered was wrong.',
  }[code] || fallback || 'The M-Pesa payment didn’t go through.';
}
