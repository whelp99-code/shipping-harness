import js from '@eslint/js';
import globals from 'globals';

/**
 * Flat ESLint config for shipping-harness.
 * Scope: src/, bin/, scripts/, test/, packages/ — the same surfaces the
 * repo's own lint/typecheck scripts cover. node_modules and dist are never
 * scanned by ESLint's default resolution, but are listed explicitly for
 * clarity and to guard against future config changes.
 */
export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'scripts/archive/**'],
  },
  {
    files: ['src/**/*.mjs', 'bin/**/*.mjs', 'scripts/**/*.mjs', 'test/**/*.mjs', 'packages/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-implicit-globals': 'error',
    },
  },
];
