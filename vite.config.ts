import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths, so the built game runs from any folder or static host
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      input: {
        main: 'index.html',
        garage: 'garage.html',
      },
    },
  },
});
