// 用途：监督统计模块的公共出口。当前只导出空壳模块 SupervisionModule。
// 调用方：backend/server/src/app.module.ts（经包名 @natural-enforcement/supervision 导入）。
// 监督统计模块公共出口（#47/#51 定案：跨模块消费只许经本文件；内部路径导入由结构测试
// module-public-entry 拦截）。空壳阶段暂无对外查询/事件接口内容，形态约定先行。
export { SupervisionModule } from './supervision.module.ts';
