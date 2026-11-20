// PROTOTYPE（#11/#12）— 根级 ESLint flat config（#9 决议：根级单一配置，不拆 packages/eslint-config）
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/src/generated/**', // prisma-client 生成物
      '**/coverage/**',
      '**/.turbo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // React hooks 规则（#12 引入 web 后启用；flat config 手工挂载——v7 的预设键名不稳定，显式规则更确定）
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // 容器内 node 工具脚本（#12 脚手架生成器）——node 全局显式声明
    files: ['devenv/gen/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
)
