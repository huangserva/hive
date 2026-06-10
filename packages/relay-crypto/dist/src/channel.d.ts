export interface EncryptedChannel {
    encrypt(plaintext: Uint8Array): string;
    decrypt(encoded: string): Uint8Array | null;
}
export declare const createEncryptedChannel: (mySecretKey: Uint8Array, theirPublicKey: Uint8Array) => EncryptedChannel;
