import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default ts.config(
  { ignores: ['node_modules/**', 'dist/**', '.scratch/**', '.firecrawl/**', '.deploy/**', 'assets/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] } },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    rules: { '@typescript-eslint/no-require-imports': 'off', '@typescript-eslint/no-unused-vars': 'off' },
  },
  {
    files: ['sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
);
