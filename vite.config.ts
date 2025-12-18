import { defineConfig } from 'vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// https://vitejs.dev/config/
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
    plugins: [crx({ manifest })],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        minify: false,
        sourcemap: true,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@page-agent/page-controller': resolve(__dirname, 'src/lib/page-controller/PageController.ts'),
            '@page-agent/ui': resolve(__dirname, 'src/lib/ui/index.ts'),
        },
    },
    publicDir: 'public',
})
