import { type EncryptedChannel } from './channel.js';
import { type KeyPair } from './keys.js';
export interface HandshakeInitMessage {
    ephemeral_public_key: string;
    version?: number;
}
export interface HandshakeResponseMessage {
    ephemeral_public_key: string;
    signature?: string;
    signing_public_key?: string;
    version?: number;
}
export interface HandshakeInitiator {
    getInitMessage(): HandshakeInitMessage;
    processResponse(msg: HandshakeResponseMessage): EncryptedChannel;
}
export interface HandshakeResponder {
    processInit(msg: HandshakeInitMessage): void;
    getResponse(): HandshakeResponseMessage;
    getChannel(): EncryptedChannel;
}
export interface HandshakeInitiatorOptions {
    expectedResponderSigningPublicKey?: Uint8Array;
}
export interface HandshakeResponderOptions {
    signingKeyPair?: KeyPair;
}
export declare const createHandshakeInitiator: (_myLongTermKeyPair: KeyPair, options?: HandshakeInitiatorOptions) => HandshakeInitiator;
export declare const createHandshakeResponder: (_myLongTermKeyPair: KeyPair, options?: HandshakeResponderOptions) => HandshakeResponder;
