/* Published ground truth for encrypt.ts, which had no test file.
 *
 * bb84.ts has one; the module that encrypts under the sifted key did not. Its
 * comments make three claims a reader can check and nothing did:
 *
 *   "ciphertext includes the GCM auth tag appended"
 *   "AES-GCM: last 16 bytes are the auth tag"
 *   "key: Uint8Array of at least 32 bytes (uses first 32)"
 *
 * The first two matter beyond correctness because the page DISPLAYS authTag
 * separately. If the tag were prepended, or 96 bits, the round trip inside this
 * module would still work and the tag shown to a visitor would be wrong bytes.
 *
 * THE VECTOR IS COPIED FROM THE PUBLICATION, not reproduced from WebCrypto. It
 * is the first Count of the [Keylen = 256] [IVlen = 96] [PTlen = 128]
 * [AADlen = 0] [Taglen = 128] section of gcmEncryptExtIV256.rsp, from NIST's
 * Cryptographic Algorithm Validation Program (gcmtestvectors.zip, fetched from
 * csrc.nist.gov). That section was chosen because its parameters are the ones
 * this module uses: a 256-bit key, a 12-byte IV, no additional data, the
 * default tag length. A vector regenerated from WebCrypto would agree with this
 * code for the same reason it agrees with itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptWithBB84Key, decryptWithBB84Key } from './encrypt.ts';

const hex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const CAVP = {
  key: '31bdadd96698c204aa9ce1448ea94ae1fb4a9a0b3c9d773b51bb1822666b8f22',
  iv: '0d18e06c7c725ac9e362e1ce',
  pt: '2db5168e932556f8089a0622981d017d',
  ct: 'fa4362189661d163fcd6a56d8bf0405a',
  tag: 'd636ac1bbedd5cc3ee727dc2ab4a9489',
};

test('AES-256-GCM matches the NIST CAVP vector, tag appended and 128 bits', async () => {
  const key = await crypto.subtle.importKey('raw', hex(CAVP.key), { name: 'AES-GCM' }, false, ['encrypt']);
  const out = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: hex(CAVP.iv) }, key, hex(CAVP.pt)));
  /* CAVP lists CT and Tag separately; WebCrypto returns them concatenated.
     Asserting the concatenation is what pins the layout this module slices. */
  assert.equal(toHex(out), CAVP.ct + CAVP.tag);
  assert.equal(out.length, 16 + 16);
  assert.equal(toHex(out.slice(out.length - 16)), CAVP.tag, 'the last 16 bytes must be the tag');
});

test('the displayed authTag really is the last 16 bytes of the ciphertext blob', async () => {
  const key = new Uint8Array(32).fill(7);
  const { ciphertext, authTag } = await encryptWithBB84Key(key, 'eavesdropper detected');
  assert.equal(authTag.length, 32, 'a 128-bit tag is 32 hex characters');
  assert.equal(ciphertext.slice(-32), authTag, 'authTag must be the tail of the blob it is sliced from');
  assert.ok(ciphertext.length > 32, 'the blob must carry ciphertext as well as a tag');
});

test('round trip, and a wrong key fails closed rather than returning plaintext', async () => {
  const key = new Uint8Array(32).fill(3);
  const { ciphertext, iv } = await encryptWithBB84Key(key, 'the sifted key agrees');
  assert.equal(await decryptWithBB84Key(key, ciphertext, iv), 'the sifted key agrees');
  for (const wrong of [new Uint8Array(32).fill(4), new Uint8Array(32), (() => { const k = new Uint8Array(32).fill(3); k[31] ^= 1; return k; })()]) {
    await assert.rejects(() => decryptWithBB84Key(wrong, ciphertext, iv),
      'a wrong key must reject, never return partial plaintext');
  }
});

test('a tampered blob fails closed even with the right key', async () => {
  const key = new Uint8Array(32).fill(9);
  const { ciphertext, iv } = await encryptWithBB84Key(key, 'tamper target');
  const bytes = hex(ciphertext);
  bytes[0] ^= 0x01;
  await assert.rejects(() => decryptWithBB84Key(key, toHex(bytes), iv));
});

test('only the first 32 bytes of the key are used, as documented', async () => {
  const short = new Uint8Array(32).fill(5);
  const long = new Uint8Array(48).fill(5);
  long.set(new Uint8Array(16).fill(0xaa), 32); // differs only past byte 32
  const { ciphertext, iv } = await encryptWithBB84Key(long, 'first 32 only');
  assert.equal(await decryptWithBB84Key(short, ciphertext, iv), 'first 32 only');
});
