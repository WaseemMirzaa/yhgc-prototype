import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import legacy from '@vitejs/plugin-legacy'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const debug = mode === 'debug'
  return {
    plugins: [
      react(),
      tailwindcss(),
      legacy({
        targets: ['defaults', 'not IE 11'],
      }),
    ],
    build: {
      outDir: debug ? 'dist-debug' : 'dist',
      sourcemap: debug,
      minify: debug ? false : true,
    },
  }
})
