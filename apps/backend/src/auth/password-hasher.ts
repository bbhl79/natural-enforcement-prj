import { hash, verify } from "@node-rs/argon2";

/** 本地账密。本票不接登录路由。 */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hashed: string): Promise<boolean>;
}

export const argon2PasswordHasher: PasswordHasher = {
  hash(plain) {
    return hash(plain);
  },
  verify(plain, hashed) {
    return verify(hashed, plain);
  },
};
