import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** 标记不要求会话的接口。健康检查、登录、会话查询使用它。 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
