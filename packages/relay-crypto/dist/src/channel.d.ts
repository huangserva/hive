export interface EncryptedChannel {
    encrypt(plaintext: Uint8Array): string;
    decrypt(encoded: string): Uint8Array | null;
}
export interface EncryptedChannelOptions {
    channelId?: string;
    receiveDirection?: string;
    sendDirection?: string;
}
export declare const createEncryptedChannelFromSharedKey: (sharedKey: Uint8Array, options?: EncryptedChannelOptions) => EncryptedChannel;
export declare const createEncryptedChannel: (mySecretKey: Uint8Array, theirPublicKey: Uint8Array, options?: EncryptedChannelOptions) => EncryptedChannel;
