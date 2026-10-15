import test from "node:test";
import assert from "node:assert/strict";
import { encrypt, vapidHeader, b64u } from "../worker/push.js";

// RFC 8291 appendix A: fixed keys and salt give a known message.
test("encrypts exactly like the RFC 8291 example", async () => {
  const out = await encrypt("When I grow up, I want to be a watermelon",
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg", {
      salt: b64u.decode("DGv6ra1nlYgDCS1FRnbzlw"),
      local: {
        publicKey: b64u.decode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
        privateKey: b64u.decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
      },
    });
  assert.equal(b64u.encode(out),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("VAPID token verifies with the public key and names the push service", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = b64u.encode(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privateKey = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d;
  const h = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc", { publicKey, privateKey, subject: "mailto:coach@x" });
  const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, publicKey);
  const [head, claims, sig] = t.split(".");
  assert.equal(JSON.parse(new TextDecoder().decode(b64u.decode(claims))).aud, "https://fcm.googleapis.com");
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, b64u.decode(sig), new TextEncoder().encode(`${head}.${claims}`)));
});
