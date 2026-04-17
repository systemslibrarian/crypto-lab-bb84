function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Encrypt a message using the BB84-derived key with AES-256-GCM.
 * key: Uint8Array of at least 32 bytes (uses first 32).
 * Returns { ciphertext, iv, authTag } all as hex strings.
 * ciphertext includes the GCM auth tag appended (needed for decryption).
 * authTag is extracted separately for display purposes.
 */
export async function encryptWithBB84Key(
  key: Uint8Array,
  message: string
): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const keyBytes = key.slice(0, 32);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encoded = new TextEncoder().encode(message);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoded
  );

  const encryptedBytes = new Uint8Array(encrypted);
  // AES-GCM: last 16 bytes are the auth tag
  const authTagBytes = encryptedBytes.slice(encryptedBytes.length - 16);

  return {
    ciphertext: hexEncode(encryptedBytes), // full blob: data + tag
    iv: hexEncode(iv),
    authTag: hexEncode(authTagBytes),
  };
}

/**
 * Decrypt a message using the BB84-derived key with AES-256-GCM.
 * ciphertext must be the full encrypted blob (data + auth tag) as hex.
 */
export async function decryptWithBB84Key(
  key: Uint8Array,
  ciphertext: string,
  iv: string
): Promise<string> {
  const keyBytes = key.slice(0, 32);
  const ivBytes = hexDecode(iv);
  const ciphertextBytes = hexDecode(ciphertext);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes as unknown as ArrayBuffer },
    cryptoKey,
    ciphertextBytes.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(decrypted);
}
