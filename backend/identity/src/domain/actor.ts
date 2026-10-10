// 动作发起人（#52）：身份校验的输入面。
// authenticated = 已完成认证（口令验真由 CredentialService 产出证据；
// 本切片无 API 层，由调用方携带该事实，E2 用例显式构造）。

export interface ActorRef {
  personnelId: string;
  authenticated: boolean;
}
