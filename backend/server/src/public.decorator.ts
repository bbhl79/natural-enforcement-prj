// 用途：声明不要求会话的接口所用的元数据键与装饰器。
// 调用方：backend/server/src/session.guard.ts 读取元数据；backend/server/src/health.controller.ts、backend/server/src/auth.controller.ts 使用装饰器。
//
import { SetMetadata } from '@nestjs/common';

/** 元数据键：会话守卫据此跳过登录校验。 */
export const IS_PUBLIC = 'isPublic';

/** 标记不要求会话的接口。健康检查、登录、会话查询使用它。 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
