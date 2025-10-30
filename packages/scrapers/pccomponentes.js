// packages/scrapers/pccomponentes.js
// -------------------------------------------------------------
// Rigscan - Scraper híbrido PCComponentes (HTTP primero, Browser fallback)
// Logs ANSI [INFO] [*] [WARN] [ERROR] · Lotes por last_scraped_at
// -------------------------------------------------------------

import { chromium } from "playwright"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import path from "path"
import { fileURLToPath } from "url"

// ========== ANSI COLORS ==========
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
}
const log = {
  info: (m) => console.log(`${C.green}[INFO]${C.reset} ${m}`),
  step: (m) => console.log(`${C.cyan}[*]${C.reset} ${m}`),
  warn: (m) => console.log(`${C.yellow}[WARN]${C.reset} ${m}`),
  error: (m) => console.error(`${C.red}[ERROR]${C.reset} ${m}`),
}

// ========== ENV ==========
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, "../../apps/web/.env.local")
dotenv.config({ path: envPath })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  log.error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local")
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ========== PARSERS ==========
function parsePrice(text) {
  const clean = String(text || "").replace(/[^\d.,]/g, "")
  const noThousands = clean.replace(/\.(?=\d{3}([\.,]|$))/g, "")
  const normalized = noThousands.replace(",", ".")
  const num = Number(normalized)
  return Number.isFinite(num) ? num : NaN
}

function extractJSONLDPriceFromHtml(html) {
  try {
    const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    for (const m of blocks) {
      const s = m[1]
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
            const p3 = Number(ofr?.priceSpecification?.price)
            if (Number.isFinite(p3)) return p3
          }
        }
      } catch {}
    }
  } catch {}
  return NaN
}

function extractPriceBySelectorsFromHtml(html) {
  // intenta price en itemprop/meta
  const meta = html.match(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i)
  if (meta?.[1]) {
    const p = parsePrice(meta[1])
    if (Number.isFinite(p) && p > 0) return p
  }
  // intento por clases comunes
  const txtCandidates = []
  const classRegex = />([^<€]{0,40}[\d]{1,3}(?:[.\s]\d{3})*[,\.]\d{2}\s*€[^<]{0,40})</g
  let m
  while ((m = classRegex.exec(html)) !== null) {
    txtCandidates.push(m[1])
  }
  if (txtCandidates.length) {
    const nums = txtCandidates
      .map((t) =>
        Number(
          t
            .replace(/[^\d.,]/g, "")
            .replace(/\.(?=\d{3}([\.,]|$))/g, "")
            .replace(",", ".")
        )
      )
      .filter((n) => Number.isFinite(n) && n > 1)
    if (nums.length) return Math.min(...nums)
  }
  return NaN
}

// ========== HTTP-FIRST (rápido, sin navegador) ==========
async function fetchPriceHTTP(url) {
  log.step(`HTTP GET → ${url}`)
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  // 1) JSON-LD
  let price = extractJSONLDPriceFromHtml(html)
  if (Number.isFinite(price) && price > 0) {
    log.info(`Precio HTTP por JSON-LD: ${price} €`)
    return { price, in_stock: true }
  }

  // 2) Selectores/meta + regex
  price = extractPriceBySelectorsFromHtml(html)
  if (Number.isFinite(price) && price > 0) {
    log.info(`Precio HTTP por selectores/regex: ${price} €`)
    return { price, in_stock: true }
  }

  throw new Error("HTTP no pudo extraer precio")
}

// ========== BROWSER FALLBACK (Playwright) ==========
async function fetchPriceBrowser(url, attempt = 1) {
  const browser = await chromium.launch({
    headless: process.env.DEBUG_HEADFUL ? false : true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    extraHTTPHeaders: { "Accept-Language": "es-ES,es;q=0.9,en;q=0.8" },
  })
  const page = await context.newPage()

  const parsePriceText = (text) => parsePrice(text)

  try {
    log.step(`Browser → ${url}`)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 })
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {})

    // Consentimiento
    const consent = [
      '#onetrust-accept-btn-handler',
      'button#onetrust-accept-btn-handler',
      'button:has-text("Aceptar")',
      'button:has-text("Aceptar todas")',
      'button:has-text("Aceptar todo")',
      'button:has-text("ACEPTAR")',
    ]
    for (const sel of consent) {
      const el = page.locator(sel).first()
      if ((await el.count()) > 0) {
        await el.click({ timeout: 2000 }).catch(() => {})
        log.info(`Consent OK: ${sel}`)
        break
      }
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
    await sleep(300)

    const selectors = [
      '[data-e2e="product-price"]',
      '[data-qa="ProductPrice"]',
      '[data-testid="price"]',
      '.price, .current-price, .product-price, .productPrice, .sale-price',
      'span[itemprop="price"]',
      'meta[itemprop="price"][content]',
    ]
    for (const sel of selectors) {
      const el = page.locator(sel).first()
      if ((await el.count()) === 0) continue
      const tag = await el.evaluate((n) => n.tagName)
      let text
      if (tag === "META") text = await el.getAttribute("content")
      else {
        await el.waitFor({ timeout: 5000 }).catch(() => {})
        text = await el.textContent({ timeout: 3000 }).catch(() => null)
      }
      const price = parsePriceText(text)
      if (Number.isFinite(price) && price > 0) {
        await browser.close()
        log.info(`Precio Browser por selector "${sel}": ${price} €`)
        return { price, in_stock: true }
      }
    }

    // JSON-LD en Browser
    const jsonPrice = await page.evaluate(() => {
      const parse = (t) => {
        try { return JSON.parse(t) } catch { return null }
      }
      const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(n => n.textContent).filter(Boolean)
      for (const s of blocks) {
        const data = parse(s); if (!data) continue
        const arr = Array.isArray(data) ? data : [data]
        for (const item of arr) {
          const offers = item?.offers; if (!offers) continue
          const list = Array.isArray(offers) ? offers : [offers]
          for (const ofr of list) {
            if (ofr?.price) return Number(ofr.price) || null
            if (ofr?.priceSpecification?.price) return Number(ofr.priceSpecification.price) || null
          }
        }
      }
      return null
    })
    if (jsonPrice && Number.isFinite(Number(jsonPrice))) {
      await browser.close()
      log.info(`Precio Browser por JSON-LD: ${jsonPrice} €`)
      return { price: Number(jsonPrice), in_stock: true }
    }

    // Regex final
    const domPrice = await page.evaluate(() => {
      const reg = /(\d{1,3}(?:[.\s]\d{3})*|\d+)[,\.]\d{2}\s*€/
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node
      const texts = []
      while ((node = walker.nextNode())) {
        const t = node.textContent
        if (t && t.includes("€")) texts.push(t)
        if (texts.length > 2000) break
      }
      for (const t of texts) {
        const m = t.match(reg)
        if (m) return m[0]
      }
      return null
    })
    if (domPrice) {
      const p = parsePrice(domPrice)
      if (Number.isFinite(p) && p > 0) {
        await browser.close()
        log.info(`Precio Browser por regex: ${p} €`)
        return { price: p, in_stock: true }
      }
    }

    await browser.close()
    throw new Error("Browser no pudo extraer precio")
  } catch (err) {
    await browser.close()
    if (attempt < 2) {
      log.warn(`Browser retry en 2s… (${err.message})`)
      await sleep(2000)
      return fetchPriceBrowser(url, attempt + 1)
    }
    throw err
  }
}

// ========== PIPELINE PRINCIPAL ==========
async function fetchPCComponentesPriceHybrid(url) {
  try {
    return await fetchPriceHTTP(url)
  } catch (e) {
    log.warn(`HTTP fallback a Browser (${e.message})`)
    return await fetchPriceBrowser(url)
  }
}

export async function scrapeAndSave({ batchSize = 20 } = {}) {
  log.step("Seleccionando lote de productos activos menos recientes…")
  const { data: products, error } = await supabase
    .from("products")
    .select("id,name,url,merchant")
    .eq("active", true)
    .eq("merchant", "pccomponentes")
    .order("last_scraped_at", { ascending: true, nullsFirst: true })
    .limit(batchSize)

  if (error) {
    log.error(`Error al leer productos: ${error.message}`)
    return
  }

  log.info(`Analizando ${products.length} producto(s)…`)
  let ok = 0

  for (const p of products) {
    log.step(`Producto: ${C.bold}${p.name}${C.reset}`)
    await supabase.from("products").update({ last_scraped_at: new Date().toISOString() }).eq("id", p.id)

    try {
      const { price, in_stock } = await fetchPCComponentesPriceHybrid(p.url)
      const { error: insertErr } = await supabase.from("price_history").insert({
        product_id: p.id,
        price,
        in_stock,
        currency: "EUR",
      })
      if (insertErr) {
        log.error(`No se pudo guardar ${p.name}: ${insertErr.message}`)
        continue
      }
      ok++
      log.info(`Guardado ${C.bold}${p.name}${C.reset} → ${C.magenta}${price}€${C.reset} (${in_stock ? "✅ stock" : "❌ sin stock"})`)
      await sleep(250)
    } catch (e) {
      log.error(`Falló ${p.name}: ${e.message}`)
    }
  }

  log.info(`Scrapeo completado. Correctos: ${ok}/${products.length}`)
}

// ========== AUTOEJECUCIÓN ==========
if (process.argv[1]?.includes("pccomponentes.js")) {
  log.step("Iniciando tarea PCComponentes…")
  scrapeAndSave()
    .then(() => log.info("Tarea finalizada."))
    .catch((e) => log.error(e?.stack || e?.message))
}
