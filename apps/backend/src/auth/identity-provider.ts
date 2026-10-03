/** 一期 IdP 预留口。本票不接外部身份源，也不暴露登录路由。 */
export interface IdentityProvider {
  readonly name: string;
}
