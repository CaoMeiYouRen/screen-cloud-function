import { Hono } from 'hono'
import puppeteer, { Browser, PuppeteerLaunchOptions } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { put } from '@vercel/blob'
import dayjs from 'dayjs'
import { createClient } from '@vercel/kv'
import { Bindings } from '../types'
import logger from '@/middlewares/logger'
import { __PROD__, __DEV__ } from '@/env'

const app = new Hono<{ Bindings: Bindings }>()

let browser: Browser = null

// 创建 KV 客户端
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
})

app.get('/screenshot', async (c) => {
    const { url, width, height, selector, clip_x, clip_y, clip_width, clip_height } = c.req.query()
    if (!url) {
        return c.text('URL is required', 400)
    }
    // 生成缓存键
    const cacheKey = `screenshot:${url}:${width}:${height}:${selector}:${clip_x}:${clip_y}:${clip_width}:${clip_height}`
    // 检查缓存
    const cachedUrl = await kv.get<string>(cacheKey)
    if (cachedUrl) {
        logger.info(`从缓存中获取截图: ${cachedUrl}`)
        return c.json({ url: cachedUrl })
    }

    // 解析分辨率设置
    const viewportWidth = width ? parseInt(width, 10) : 1920
    const viewportHeight = height ? parseInt(height, 10) : 1080
    const defaultViewport = {
        width: viewportWidth,
        height: viewportHeight,
    }
    const clip = {
        x: clip_x ? parseInt(clip_x, 10) : 0,
        y: clip_y ? parseInt(clip_y, 10) : 0,
        width: clip_width ? parseInt(clip_width, 10) : viewportWidth,
        height: clip_height ? parseInt(clip_height, 10) : viewportHeight,
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

    if (!browser || !browser.connected) {
        browser = await puppeteer.launch(options)
        browser.on('disconnected', () => {
            logger.info('浏览器断开连接')
            // 断开后设为 falsy 值
            browser = null
        })
    }

    const page = await browser.newPage()
    logger.info('正在打开页面……')
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45 * 1000 })

    let screenshot: Uint8Array
    if (selector) {
        // 截取指定区间的截图
        const element = await page.$(selector)
        if (!element) {
            return c.text('Selector not found', 404)
        }
        screenshot = await element.screenshot({
            clip,
        })
    } else {
        // 截取整个页面的截图
        screenshot = await page.screenshot({
            clip,
        })
    }

    logger.info('截图成功')

    // 生成唯一的文件名
    const fileName = `images/screenshot_${dayjs().format('YYYYMMDDHHmmssSSS')}.png`

    // 上传截图到 Vercel Blob
    const { url: blobUrl } = await put(fileName, Buffer.from(screenshot), {
        access: 'public',
    })

    // 将截图存储到缓存
    await kv.set(cacheKey, blobUrl, {
        ex: parseInt(process.env.CACHE_MAX_AGE) || 60 * 60 * 2, // 缓存时间为 2 小时
        nx: true, // 只有在键不存在时才设置缓存
    })

    if (__DEV__) {
        await browser.close()
        logger.info('浏览器关闭成功')
    } else {
        await page.close()
        logger.info('页面关闭成功')
    }
    // 返回截图的链接
    return c.json({ url: blobUrl })
})

export default app
