// ESLint 10 flat config（#60 定案：ESLint 10 + typescript-eslint 8，与 TS 6.0.2 配对）
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/*.md'] },
  tseslint.configs.recommended,
);
