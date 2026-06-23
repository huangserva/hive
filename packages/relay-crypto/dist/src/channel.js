import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from './encoding.js';
import { deriveSessionKey } from './keys.js';
const NONCE_PREFIX_BYTES = 16;
const NONCE_COUNTER_BYTES = 8;
const NONCE_TOTAL_BYTES = nacl.box.nonceLength;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const randomChannelId = () => encodeBase64(nacl.randomBytes(16));
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const parseFrame = (encoded) => {
    try {
        const parsed = JSON.parse(textDecoder.decode(decodeBase64(encoded)));
        if (!isObject(parsed) ||
            parsed.version !== 2 ||
            typeof parsed.channel_id !== 'string' ||
            typeof parsed.direction !== 'string' ||
            typeof parsed.counter !== 'number' ||
            !Number.isSafeInteger(parsed.counter) ||
            parsed.counter < 0 ||
            typeof parsed.nonce !== 'string' ||
            typeof parsed.payload !== 'string') {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
};
export const createEncryptedChannelFromSharedKey = (sharedKey, options = {}) => {
    const channelId = options.channelId ?? randomChannelId();
    const sendDirection = options.sendDirection ?? 'bidirectional';
    const receiveDirection = options.receiveDirection ?? sendDirection;
    const noncePrefix = nacl.randomBytes(NONCE_PREFIX_BYTES);
    let counter = 0;
    let lastSeenCounter = -1;
    let receiveChannelId = null;
    const nextNonce = () => {
        const nonce = new Uint8Array(NONCE_TOTAL_BYTES);
        nonce.set(noncePrefix, 0);
        const view = new DataView(nonce.buffer, nonce.byteOffset + NONCE_PREFIX_BYTES, NONCE_COUNTER_BYTES);
        view.setBigUint64(0, BigInt(counter), false);
        counter++;
        return nonce;
    };
    const decryptLegacyBundle = (bundle) => {
        if (bundle.length < NONCE_TOTAL_BYTES + nacl.box.overheadLength) {
            return null;
        }
        const nonce = bundle.subarray(0, NONCE_TOTAL_BYTES);
        const ciphertext = bundle.subarray(NONCE_TOTAL_BYTES);
        return nacl.box.open.after(ciphertext, nonce, sharedKey) ?? null;
    };
    return {
        encrypt(plaintext) {
            const nonce = nextNonce();
            const frameCounter = counter - 1;
            const ciphertext = nacl.box.after(plaintext, nonce, sharedKey);
            const frame = {
                channel_id: channelId,
                counter: frameCounter,
                direction: sendDirection,
                nonce: encodeBase64(nonce),
                payload: encodeBase64(ciphertext),
                version: 2,
            };
            return encodeBase64(textEncoder.encode(JSON.stringify(frame)));
        },
        decrypt(encoded) {
            const frame = parseFrame(encoded);
            if (!frame) {
                return decryptLegacyBundle(decodeBase64(encoded));
            }
            if (frame.direction !== receiveDirection)
                return null;
            if (receiveChannelId && frame.channel_id !== receiveChannelId)
                return null;
            if (frame.counter <= lastSeenCounter)
                return null;
            const nonce = decodeBase64(frame.nonce);
            const ciphertext = decodeBase64(frame.payload);
            if (nonce.length !== NONCE_TOTAL_BYTES)
                return null;
            const opened = nacl.box.open.after(ciphertext, nonce, sharedKey) ?? null;
            if (!opened)
                return null;
            receiveChannelId = frame.channel_id;
            lastSeenCounter = frame.counter;
            return opened;
        },
    };
};
export const createEncryptedChannel = (mySecretKey, theirPublicKey, options = {}) => {
    const sharedKey = deriveSessionKey(mySecretKey, theirPublicKey);
    return createEncryptedChannelFromSharedKey(sharedKey, options);
};
