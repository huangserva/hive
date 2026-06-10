import { createEncryptedChannel } from './channel.js';
import { decodeBase64, encodeBase64 } from './encoding.js';
import { generateEphemeralKeyPair } from './keys.js';
export const createHandshakeInitiator = (_myLongTermKeyPair) => {
    const ephemeral = generateEphemeralKeyPair();
    let channel = null;
    return {
        getInitMessage() {
            return { ephemeral_public_key: encodeBase64(ephemeral.publicKey) };
        },
        processResponse(msg) {
            if (channel)
                throw new Error('Handshake already completed');
            const theirEphemeralPublicKey = decodeBase64(msg.ephemeral_public_key);
            channel = createEncryptedChannel(ephemeral.secretKey, theirEphemeralPublicKey);
            return channel;
        },
    };
};
export const createHandshakeResponder = (_myLongTermKeyPair) => {
    const ephemeral = generateEphemeralKeyPair();
    let theirEphemeralPublicKey = null;
    let channel = null;
    return {
        processInit(msg) {
            if (theirEphemeralPublicKey)
                throw new Error('Init already processed');
            theirEphemeralPublicKey = decodeBase64(msg.ephemeral_public_key);
        },
        getResponse() {
            return { ephemeral_public_key: encodeBase64(ephemeral.publicKey) };
        },
        getChannel() {
            if (!theirEphemeralPublicKey)
                throw new Error('Init not yet processed');
            if (!channel) {
                channel = createEncryptedChannel(ephemeral.secretKey, theirEphemeralPublicKey);
            }
            return channel;
        },
    };
};
