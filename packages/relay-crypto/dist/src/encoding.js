export const encodeBase64 = (bytes) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};
export const decodeBase64 = (str) => {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const encodeJson = (obj) => textEncoder.encode(JSON.stringify(obj));
export const decodeJson = (bytes) => JSON.parse(textDecoder.decode(bytes));
