import { type EncryptedChannel } from './channel.js';
import { type KeyPair } from './keys.js';
export interface HandshakeInitMessage {
    ephemeral_public_key: string;
}
export interface HandshakeResponseMessage {
    ephemeral_public_key: string;
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
export declare const createHandshakeInitiator: (_myLongTermKeyPair: KeyPair) => HandshakeInitiator;
export declare const createHandshakeResponder: (_myLongTermKeyPair: KeyPair) => HandshakeResponder;
