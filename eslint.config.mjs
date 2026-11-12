// 用途：全仓 ESLint 10 flat config（#60 定案：ESLint 10 + typescript-eslint 8，与 TS 6.0.2 配对）。
// 只启用 recommended 集；忽略项排除 Markdown、构建产物与前端原型。
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/*.md', '**/dist/**', 'frontend/prototype/**'] },
  tseslint.configs.recommended,
);
