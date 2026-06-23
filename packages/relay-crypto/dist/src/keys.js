import nacl from 'tweetnacl';
export const generateKeyPair = () => nacl.box.keyPair();
export const generateEphemeralKeyPair = () => nacl.box.keyPair();
export const generateSigningKeyPair = () => nacl.sign.keyPair();
export const deriveSessionKey = (mySecretKey, theirPublicKey) => nacl.box.before(theirPublicKey, mySecretKey);
export const signDetached = (message, secretKey) => nacl.sign.detached(message, secretKey);
export const verifyDetached = (message, signature, publicKey) => nacl.sign.detached.verify(message, signature, publicKey);
