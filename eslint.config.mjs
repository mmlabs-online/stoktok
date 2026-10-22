import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextConfig from 'eslint-config-next';

export default [
  { ignores: ['**/.next/**', '**/dist/**', '**/next-env.d.ts', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextConfig.map((c) => ({ ...c, files: ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'] })),
];
