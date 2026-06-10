import nacl from 'tweetnacl';
export const generateKeyPair = () => nacl.box.keyPair();
export const generateEphemeralKeyPair = () => nacl.box.keyPair();
export const deriveSessionKey = (mySecretKey, theirPublicKey) => nacl.box.before(theirPublicKey, mySecretKey);
