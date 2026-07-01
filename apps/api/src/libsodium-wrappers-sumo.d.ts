declare module "libsodium-wrappers-sumo" {
  type SecretStreamState = unknown;

  interface SodiumWrappersSumo {
    readonly ready: Promise<void>;
    readonly crypto_pwhash_ALG_ARGON2ID13: number;
    readonly crypto_pwhash_SALTBYTES: number;
    readonly crypto_secretstream_xchacha20poly1305_ABYTES: number;
    readonly crypto_secretstream_xchacha20poly1305_HEADERBYTES: number;
    readonly crypto_secretstream_xchacha20poly1305_KEYBYTES: number;
    readonly crypto_secretstream_xchacha20poly1305_TAG_FINAL: number;
    readonly crypto_secretstream_xchacha20poly1305_TAG_MESSAGE: number;

    from_string(value: string): Uint8Array;
    randombytes_buf(length: number): Uint8Array;
    crypto_pwhash(
      outputLength: number,
      password: string | Uint8Array,
      salt: Uint8Array,
      opslimit: number,
      memlimit: number,
      algorithm: number
    ): Uint8Array;
    crypto_secretstream_xchacha20poly1305_init_push(
      key: Uint8Array
    ): { state: SecretStreamState; header: Uint8Array };
    crypto_secretstream_xchacha20poly1305_push(
      state: SecretStreamState,
      message: Uint8Array,
      associatedData: Uint8Array | null,
      tag: number
    ): Uint8Array;
    crypto_secretstream_xchacha20poly1305_init_pull(
      header: Uint8Array,
      key: Uint8Array
    ): SecretStreamState;
    crypto_secretstream_xchacha20poly1305_pull(
      state: SecretStreamState,
      ciphertext: Uint8Array,
      associatedData?: Uint8Array | null
    ): false | { message: Uint8Array; tag: number };
  }

  const sodium: SodiumWrappersSumo;
  export default sodium;
}
