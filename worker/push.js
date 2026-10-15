// Sends one Web Push message: encrypts the payload for the subscriber (RFC 8291, aes128gcm) and signs
// a VAPID token (RFC 8292) with the coach's key. Plain WebCrypto, so it runs in a Cloudflare Worker.

const enc = new TextEncoder();
export const b64u = {
  encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}
// A P-256 key as JWK from its raw 65-byte public point (and optional 32-byte private scalar).
const jwk = (pub, d) => ({ kty: "EC", crv: "P-256", x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ...(d ? { d: b64u.encode(d) } : {}) });

// `local` ({publicKey, privateKey} raw bytes) and `salt` are only passed by tests, to check against the RFC's example.
export async function encrypt(plaintext, p256dh, authSecret, { local, salt } = {}) {
  const uaPublic = b64u.decode(p256dh), auth = b64u.decode(authSecret);
  salt ||= crypto.getRandomValues(new Uint8Array(16));
  let asPrivate, asPublic;
  if (local) {
    asPublic = local.publicKey;
    asPrivate = await crypto.subtle.importKey("jwk", jwk(asPublic, local.privateKey), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = kp.privateKey; asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(plaintext), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, body);
}

export async function vapidHeader(endpoint, { publicKey, privateKey, subject }) {
  const pub = b64u.decode(publicKey);
  const key = await crypto.subtle.importKey("jwk", jwk(pub, b64u.decode(privateKey)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u.encode(sig)}, k=${publicKey}`;
}

export async function sendPush(subscription, payload, vapid) {
  const body = await encrypt(payload, subscription.keys.p256dh, subscription.keys.auth);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: { Authorization: await vapidHeader(subscription.endpoint, vapid), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" },
    body,
  });
}
