import { Hono } from 'hono'
import puppeteer, { Browser, PuppeteerLaunchOptions } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { Bindings } from '../types'
import logger from '@/middlewares/logger'
import { __PROD__, __DEV__ } from '@/env'

const app = new Hono<{ Bindings: Bindings }>()

let browser: Browser = null

app.get('/screenshot', async (c) => {
    const { url } = c.req.query()
    if (!url) {
        return c.text('URL is required', 400)
    }
    const defaultViewport = {
        width: 1920,
        height: 1080,
    }
    const options: PuppeteerLaunchOptions = __PROD__
        ? {
            args: chromium.args,
            defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            // headless: true,
            // args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-infobars', '--disable-gpu', '--window-position=0,0', '--ignore-certificate-errors', '--ignore-certificate-errors-spki-list'],
        }
        : {
            defaultViewport,
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-infobars', '--disable-gpu', '--window-position=0,0', '--ignore-certificate-errors', '--ignore-certificate-errors-spki-list'],
            executablePath: puppeteer.executablePath('chrome'),
        }
    if (!browser) {
        browser = await puppeteer.launch(options)
        browser.on('disconnected', () => {
            logger.info('浏览器断开连接')
            // 断开后设为 falsy 值
            browser = null
        })
    }
    const page = await browser.newPage()
    logger.info('正在打开页面……')
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30 * 1000 })
    // await page.waitForSelector('.match-module-container > div > div > div.svg > svg')

    const screenshot = await page.screenshot()
    logger.info('截图成功')
    if (__DEV__) {
        await browser.close()
        logger.info('浏览器关闭成功')
    } else {
        await page.close()
        logger.info('页面关闭成功')
    }

    c.header('Content-Type', 'image/png')
    return c.body(screenshot as any)
})

export default app
