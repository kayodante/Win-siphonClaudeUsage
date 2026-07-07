import globals from 'globals';

// Correctness-only lint pass. Complements scripts/check-syntax.js (which only
// checks parseability) and fallow (file-level dead-code). Deliberately no style
// rules — formatting is hand-maintained. See CLAUDE.md "Conventions when editing".
const correctnessRules = {
  'no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'none'
  }],
  'no-undef': 'error'
};

export default [
  {
    ignores: ['node_modules/**', 'graphify-out/**', '.impeccable/**', 'dist/**']
  },
  {
    // Main process, shared modules, build scripts, tests — Node ESM.
    files: ['src/main/**/*.js', 'src/shared/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: correctnessRules
  },
  {
    // CommonJS preload + electron-builder hook.
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: correctnessRules
  },
  {
    // Renderer — browser context (window.siphon bridge, DOM, rAF).
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser }
    },
    rules: correctnessRules
  }
];
