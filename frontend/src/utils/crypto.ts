import CryptoJS from 'crypto-js';

const SALT = "YOUR_SALT_HERE"; // Must match backend SALT

export const getClientNonce = () => {
    return Math.random().toString(36).substring(2, 10);
};

export const calculateHash = (parts: string[], serverNonce: string) => {
    // raw = "".join(parts) + salt + str(nonce)
    const raw = parts.join('') + SALT + serverNonce;
    return CryptoJS.SHA256(raw).toString(CryptoJS.enc.Hex);
};
