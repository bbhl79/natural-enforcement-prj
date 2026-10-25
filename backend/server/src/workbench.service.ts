// 工作台卡片计数服务（#207）。
// 从 ClueStore 取数，按操作者机构子树过滤。

import { Inject, Injectable } from '@nestjs/common';

import {
  CLUE_STORE,
  type ClueStore,
  type WorkbenchCardCounts,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  type ActorRef,
  type DenyReason,
  type IdentityStore,
} from '@natural-enforcement/identity';

import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';

const READ_OPCODE = 'clue.read';

/** 工作台卡片计数成功结果。 */
export interface CardCountsOutcome {
  readonly status: 200;
  readonly body: WorkbenchCardCounts;
}

/** 工作台卡片计数拒绝结果。 */
export interface CardCountsDenial {
  readonly status: 403;
  readonly body: { readonly reason: DenyReason };
}

@Injectable()
export class WorkbenchService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    private readonly access: AccessControlService,
  ) {}

  /** 加载工作台卡片计数：操作者可见范围内的全部卡片数字。 */
  async loadCardCounts(actor: ActorRef): Promise<CardCountsOutcome | CardCountsDenial> {
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    try {
      await this.access.authorize(actor, READ_OPCODE, actorOrgId, {
        resourceType: 'clue',
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const scope = await this.identity.listOrgUnitSubtreeIds(actorOrgId);
    const counts = await this.clues.countWorkbenchCards(scope);
    return { status: 200, body: counts };
  }
}