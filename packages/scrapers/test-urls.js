// packages/scrapers/test-urls.js
// -------------------------------------------------------------
// Rigscan - Test puntual de URLs (solo las que pases por CLI)
// Uso:
//   npm run test:urls -- "https://url1" "https://url2" ...
// o
//   node packages/scrapers/test-urls.js "https://..." "https://..."
// -------------------------------------------------------------

import { chromium } from "playwright"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import path from "path"
import { fileURLToPath } from "url"

// ANSI logs
const C = { reset:"\x1b[0m", bold:"\x1b[1m", green:"\x1b[32m", cyan:"\x1b[36m", yellow:"\x1b[33m", red:"\x1b[31m", magenta:"\x1b[35m", gray:"\x1b[90m" }
const log = {
  info: (m) => console.log(`${C.green}[INFO]${C.reset} ${m}`),
  step: (m) => console.log(`${C.cyan}[*]${C.reset} ${m}`),
  warn: (m) => console.log(`${C.yellow}[WARN]${C.reset} ${m}`),
  error: (m) => console.error(`${C.red}[ERROR]${C.reset} ${m}`)
}

// ENV (usa .env.local de la web)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, "../../apps/web/.env.local")
dotenv.config({ path: envPath })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  log.error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local")
  process.exit(1)
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// Helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function parsePrice(text) {
  const clean = String(text || "").replace(/[^\d.,]/g, "")
  const noThousands = clean.replace(/\.(?=\d{3}([\.,]|$))/g, "")
  const normalized = noThousands.replace(",", ".")
  const n = Number(normalized)
  return Number.isFinite(n) ? n : NaN
}
async function readPriceFromJSONLD(page) {
  try {
    const scripts = await page.$$eval('script[type="application/ld+json"]', (nodes) => nodes.map(n => n.textContent).filter(Boolean))
    for (const s of scripts) {
      try {
        const data = JSON.parse(s)
        const arr = Array.isArray(data) ? data : [data]
        for (const item of arr) {
          const offers = item?.offers
          if (!offers) continue
          const list = Array.isArray(offers) ? offers : [offers]
          for (const ofr of list) {
            if (ofr?.price) {
              const p = Number(ofr.price); if (Number.isFinite(p)) return p
              const p2 = parsePrice(ofr.price); if (Number.isFinite(p2)) return p2
            }
            const p3 = Number(ofr?.priceSpecification?.price); if (Number.isFinite(p3)) return p3
          }
        }
      } catch {}
    }
  } catch {}
  return NaN
}
async function clickIfVisible(page, selectors = []) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first()
      if ((await el.count()) > 0) {
        await el.click({ timeout: 2000 }).catch(() => {})
        log.info(`Click consentimiento: "${sel}"`)
        await sleep(250)
        return true
      }
    } catch {}
  }
  return false
}
async function extractPrice(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 90000 })
  await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {})

  await clickIfVisible(page, [
    '#onetrust-accept-btn-handler',
    'button#onetrust-accept-btn-handler',
    'button:has-text("Aceptar")',
    'button:has-text("Aceptar todas")',
    'button:has-text("Aceptar todo")',
    'button:has-text("ACEPTAR")',
  ])

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 4))
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))

  const selectors = [
    '[data-e2e="product-price"]',
    '[data-qa="ProductPrice"]',
    '[data-testid="price"]',
    '.price, .current-price, .product-price, .productPrice, .sale-price',
    'span[itemprop="price"]',
    'meta[itemprop="price"][content]',
  ]
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first()
      if ((await el.count()) === 0) continue
      const tag = await el.evaluate((n) => n.tagName)
      let text
      if (tag === "META") text = await el.getAttribute("content")
      else {
        await el.waitFor({ timeout: 5000 }).catch(() => {})
        text = await el.textContent({ timeout: 3000 }).catch(() => null)
      }
      const price = parsePrice(text)
      if (Number.isFinite(price) && price > 0) {
        log.info(`Precio por selector "${sel}": ${price} €`)
        return price
      }
    } catch {}
  }
  const jsonPrice = await readPriceFromJSONLD(page)
  if (Number.isFinite(jsonPrice) && jsonPrice > 0) {
    log.info(`Precio por JSON-LD: ${jsonPrice} €`)
    return jsonPrice
  }
  const best = await page.evaluate(() => {
    const reg = /(\d{1,3}(?:[.\s]\d{3})*|\d+)[,\.]\d{2}\s*€/g
    const texts = Array.from(document.querySelectorAll("body *"))
      .slice(0, 3000)
      .map((n) => n.textContent || "")
      .filter((t) => t && t.includes("€"))
    const out = new Set()
    for (const t of texts) (t.match(reg) || []).forEach(m => out.add(m))
    return Array.from(out)
  })
  if (best?.length) {
    const nums = best
      .map((t) => Number(t.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}([\.,]|$))/g, "").replace(",", ".")))
      .filter((n) => Number.isFinite(n) && n > 1)
    if (nums.length) {
      const chosen = Math.min(...nums)
      log.info(`Precio por escaneo global: ${chosen} €`)
      return chosen
    }
  }
  return NaN
}

async function fetchPriceOnce(url) {
  const browser = await chromium.launch({
    headless: process.env.DEBUG_HEADFUL ? false : true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    extraHTTPHeaders: { "Accept-Language": "es-ES,es;q=0.9,en;q=0.8" }
  })
  const page = await context.newPage()

  try {
    log.step(`Navegando → ${url}`)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 })
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {})

    const price = await extractPrice(page)
    if (!Number.isFinite(price)) throw new Error("No se pudo extraer el precio")
    const inStock = true // heurística básica; si necesitas exactitud, reusa extractStock del otro archivo

    await browser.close()
    return { price, in_stock: inStock }
  } catch (e) {
    await browser.close()
    throw e
  }
}

async function run() {
  const urls = process.argv.slice(2).filter(Boolean)
  if (!urls.length) {
    log.warn('Uso: node packages/scrapers/test-urls.js "https://url1" "https://url2" ...')
    process.exit(1)
  }
  log.step(`Recibidas ${urls.length} URL(s)`)

  // Obtener productos por URL
  const { data: products, error } = await supabase
    .from("products")
    .select("id,name,url")
    .in("url", urls)
  if (error) {
    log.error(`Error leyendo products: ${error.message}`)
    process.exit(1)
  }
  log.info(`Encontrados ${products.length} en products`)

  let ok = 0
  for (const p of products) {
    log.step(`Producto: ${C.bold}${p.name}${C.reset}`)
    try {
      const { price, in_stock } = await fetchPriceOnce(p.url)
      const { error: insErr } = await supabase.from("price_history").insert({
        product_id: p.id,
        price,
        in_stock,
        currency: "EUR"
      })
      if (insErr) {
        log.error(`No se pudo guardar ${p.name}: ${insErr.message}`)
      } else {
        ok++
        log.info(`Guardado ${C.bold}${p.name}${C.reset} → ${C.magenta}${price}€${C.reset}`)
      }
      // marca last_scraped_at
      await supabase.from("products").update({ last_scraped_at: new Date().toISOString() }).eq("id", p.id)
    } catch (e) {
      log.error(`Falló ${p.name}: ${e.message}`)
    }
  }
  log.info(`Test completado. Correctos: ${ok}/${products.length}`)
}

if (process.argv[1]?.includes("test-urls.js")) {
  run().catch(e => log.error(e?.stack || e?.message))
}
