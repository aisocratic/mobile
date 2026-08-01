/**
 * `react-native-get-random-values` ships no type declarations. We only import it
 * for its side effect (installing `global.crypto.getRandomValues`), which
 * @noble/curves needs for BIP-340 auxiliary randomness.
 */
declare module "react-native-get-random-values"
