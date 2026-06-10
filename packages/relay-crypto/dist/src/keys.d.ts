export interface KeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}
export declare const generateKeyPair: () => KeyPair;
export declare const generateEphemeralKeyPair: () => KeyPair;
export declare const deriveSessionKey: (mySecretKey: Uint8Array, theirPublicKey: Uint8Array) => Uint8Array;
