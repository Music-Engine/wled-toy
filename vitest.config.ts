import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'

// audio tests: a synthetic microphone, no permission prompt, and an AudioContext that may start without a click
const MEDIA_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
// headless Chromium has no GPU; SwiftShader gives it a software WebGL2 context
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
// BENCH_GPU=1 asks for the real GPU instead, for benchmark runs; BENCH_GPU=headed also drops headless mode
const GPU = process.env.BENCH_GPU === '1' || process.env.BENCH_GPU === 'headed'
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // discovered late, these make Vite re-optimize and reload the page in the middle of a browser run
  optimizeDeps: {
    include: [
      'vue', 'vue-router', '@vue-flow/core', '@vue-flow/background', '@vue-flow/controls', '@vue-flow/minimap', 'reka-ui', '@vueuse/core',
      '@tauri-apps/plugin-opener',
      '@codemirror/autocomplete', '@codemirror/commands', '@codemirror/language', '@codemirror/lint', '@codemirror/search', '@codemirror/state', '@codemirror/view', '@lezer/highlight',
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', '*.test.ts'],
          exclude: ['src/**/*.browser.test.ts', 'project-three/**', 'node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          // Vue Flow's fit-on-init alone takes over the default second in software-rendered Chromium on a loaded machine
          expect: { poll: { timeout: 5000 } },
          browser: {
            enabled: true,
            headless: process.env.BENCH_GPU !== 'headed',
            screenshotFailures: false,
            provider: playwright({
              launchOptions: { args: [...(GPU ? GPU_ARGS : SWIFTSHADER_ARGS), ...MEDIA_ARGS] },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
