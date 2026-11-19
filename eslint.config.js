// PROTOTYPE（#11）— 根级 ESLint flat config（#9 决议：根级单一配置，不拆 packages/eslint-config）
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

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
)
