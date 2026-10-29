import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        editor: resolve(process.cwd(), 'editor.html'),
      },
    },
  },
});
