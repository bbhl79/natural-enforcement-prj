// 根级 ESLint flat config（#9 决议：根级单一配置，不拆 packages/eslint-config）
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
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
    // 零第三方依赖复现脚本（apps/e2e/replay/<DEF-NNNN>.mjs，#109 起随缺陷记录入库）：
    // 裸 node ESM，只用内建能力（fetch/process/console/Buffer…）。它们是 JS 而非 TS，
    // 不经 tseslint 关闭 no-undef，故显式声明 node 全局——保留 no-undef 对拼写错误的
    // 检查力，同时不误报内建能力。约定见 apps/e2e/replay/README.md。
    files: ['apps/e2e/replay/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    // React 规则（flat config 显式挂载：hooks + eslint-plugin-react 最小正确性规则面，#68；
    // 不启用与 TS 6 strict 重复或纯风格类的 prop-types / unescaped-entities 等规则）。
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      // 显式对齐 catalog 的 React 19.3.1，避免 version:'detect' 跨工作区解析差异
      react: { version: '19.3' },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-key': ['error', { checkFragmentShorthand: true }],
      'react/jsx-no-comment-textnodes': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger-with-children': 'error',
      'react/no-direct-mutation-state': 'error',
      'react/no-find-dom-node': 'error',
      'react/no-is-mounted': 'error',
      'react/no-render-return-value': 'error',
      'react/no-string-refs': 'error',
      'react/no-unstable-nested-components': ['error', { allowAsProps: true }],
      'react/void-dom-elements-no-children': 'error',
    },
  },
)
