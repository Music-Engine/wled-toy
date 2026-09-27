import { chromium } from 'playwright'
const [url, seconds, configPath] = [process.argv[2], Number(process.argv[3] ?? 60), process.argv[4] ?? '/src/lib/app/settings/config.ts']
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.goto(url)
await page.waitForTimeout(4000)
await page.evaluate(async (configPath) => {
  const { useEngine } = await import('/src/lib/engine/engine.ts')
  const { config } = await import(configPath)
  const engine = useEngine()
  config.fps = 60
  config.ledCount = 300
  if (!engine.streaming.value) engine.toggleStream()
}, configPath)
console.log('load running', url)
await page.waitForTimeout(seconds * 1000)
await browser.close()
console.log('load done')
