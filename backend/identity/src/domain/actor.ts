// 用途：定义授权输入的动作发起人：人员标识与是否已认证。
// 调用方：AccessControlService 的授权入口，以及 backend/server/src/ 下各业务服务。
// 动作发起人（#52）：身份校验的输入面。
// authenticated = 已完成认证（口令验真由 CredentialService 产出证据；
// 本切片无 API 层，由调用方携带该事实，E2 用例显式构造）。

/** 动作发起人。authenticated 由认证环节产出，授权判定只读不改。 */
export interface ActorRef {
  personnelId: string;
  authenticated: boolean;
}
