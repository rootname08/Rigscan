// packages/scrapers/rigscan.js
// -------------------------------------------------------------
// Rigscan "Turbo-híbrido":
// 1) HTTP con reintentos + detección anti-bot
// 2) Fallback Browser ULTRARRÁPIDO:
//    - bloquea imágenes/CSS/fonts/media
//    - primer intento JS desactivado (si no vale, reintento con JS)
// 3) Concurrencia controlada (--concurrency N)
// Flags:
//   --force              ignora ventana 24h
//   --limit N            limita nº de productos
//   --merchant NAME      amazon | pccomponentes
//   --concurrency N      nº de productos en paralelo (def. 3)
//   --headful            ver ventana (debug)
// -------------------------------------------------------------
import { chromium, request as pwrequest } from "playwright"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import path from "path"
import { fileURLToPath } from "url"

// ===== Colores/log =====
const C = { reset:"\x1b[0m", bold:"\x1b[1m", green:"\x1b[32m", cyan:"\x1b[36m", yellow:"\x1b[33m", red:"\x1b[31m", magenta:"\x1b[35m", gray:"\x1b[90m" }
const log = {
  info: (m)=>console.log(`${C.green}[INFO]${C.reset} ${m}`),
  step: (m)=>console.log(`${C.cyan}[*]${C.reset} ${m}`),
  warn: (m)=>console.log(`${C.yellow}[WARN]${C.reset} ${m}`),
  error:(m)=>console.error(`${C.red}[ERROR]${C.reset} ${m}`)
}

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, "../../apps/web/.env.local") })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  log.error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en apps/web/.env.local")
  process.exit(1)
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// ===== Flags CLI =====
const ARGS = process.argv.slice(2)
const FORCE = ARGS.includes("--force")
const limIdx = ARGS.indexOf("--limit")
const LIMIT  = limIdx !== -1 ? Math.max(1, Number(ARGS[limIdx+1]) || 0) : 0
const merIdx = ARGS.indexOf("--merchant")
const MERCHANT = merIdx !== -1 ? String(ARGS[merIdx+1] || "").toLowerCase() : ""
const concIdx = ARGS.indexOf("--concurrency")
const CONCURRENCY = concIdx !== -1 ? Math.max(1, Number(ARGS[concIdx+1]) || 0) : 3
const HEADFUL = ARGS.includes("--headful") || !!process.env.DEBUG_HEADFUL

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms))

// ===== Utils =====
function parsePrice(text){
  const clean = String(text||"").replace(/[^\d.,]/g,"")
  const noThousands = clean.replace(/\.(?=\d{3}([\.,]|$))/g,"")
  const normalized = noThousands.replace(",",".")
  const n = Number(normalized)
  return Number.isFinite(n)?n:NaN
}
function looksLikeBotWall(html){
  const s = (html||"").toLowerCase()
  return s.includes("are you a robot") || s.includes("captcha") || s.includes("sorry, we just need to make sure")
}

// ===== HTTP (con Playwright request) =====
async function httpGet(url){
  const ctx = await pwrequest.newContext({
    extraHTTPHeaders:{
      "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "Accept-Language":"es-ES,es;q=0.9,en;q=0.8",
      "Cache-Control":"no-cache"
    },
    ignoreHTTPSErrors: true,
    timeout: 30000
  })
  try{
    const res = await ctx.get(url)
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`)
    return await res.text()
  } finally {
    await ctx.dispose()
  }
}

// ===== Amazon parsers =====
function extractAmazonPrice(html){
  const m = html.match(/<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>(.*?)<\/span>/i)
  if (m?.[1] && m[1].includes("€")){
    const p = parsePrice(m[1]); if (Number.isFinite(p)&&p>0) return p
  }
  const m2 = html.match(/(\d{1,3}(?:[.\s]\d{3})*|\d+)[,\.]\d{2}\s*€/)
  if (m2?.[0]){ const p=parsePrice(m2[0]); if(Number.isFinite(p)&&p>0) return p }
  return NaN
}
function extractAmazonImages(html){
  const m = html.match(/id=["']landingImage["'][\s\S]*?data-a-dynamic-image=["']([^"']+)["']/i)
  if(!m?.[1]) return []
  try{
    const json = JSON.parse(m[1].replace(/&quot;/g,'"'))
    return Object.keys(json).slice(0,3)
  }catch{ return [] }
}
async function fetchAmazonHTTP(url){
  log.step(`HTTP GET (Amazon) → ${url}`)
  const html = await httpGet(url)
  if (looksLikeBotWall(html)) throw new Error("Amazon bot-wall")
  const price = extractAmazonPrice(html)
  if(!Number.isFinite(price)) throw new Error("Amazon HTTP no pudo extraer precio")
  const images = extractAmazonImages(html)
  log.info(`Amazon precio HTTP: ${price} €  | imágenes: ${images.length}`)
  return { price, in_stock:true, images }
}

// ===== PCC parsers =====
function extractPccPrice(html){
  const m = html.match(/id=["']pdp-price-current-container["'][^>]*>([\s\S]*?)<\/span>/i)
  if(m?.[1]){
    const text = m[1].replace(/<[^>]+>/g,"")
    const p = parsePrice(text); if(Number.isFinite(p)&&p>0) return p
  }
  // JSON-LD
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for(const b of blocks){
    try{
      const data = JSON.parse(b[1])
      const arr = Array.isArray(data)?data:[data]
      for(const item of arr){
        const offers = item?.offers; if(!offers) continue
        const list = Array.isArray(offers)?offers:[offers]
        for(const ofr of list){
          const p1 = Number(ofr?.price); if(Number.isFinite(p1)) return p1
          const p2 = parsePrice(ofr?.price); if(Number.isFinite(p2)) return p2
        }
      }
    }catch{}
  }
  const m2 = html.match(/(\d{1,3}(?:[.\s]\d{3})*|\d+)[,\.]\d{2}\s*€/)
  if(m2?.[0]){ const p=parsePrice(m2[0]); if(Number.isFinite(p)&&p>0) return p }
  return NaN
}
async function fetchPccHTTP(url){
  log.step(`HTTP GET (PCC) → ${url}`)
  const html = await httpGet(url)
  if (looksLikeBotWall(html)) throw new Error("PCC bot-wall")
  const price = extractPccPrice(html)
  if(!Number.isFinite(price)) throw new Error("PCC HTTP no pudo extraer precio")
  log.info(`PCC precio HTTP: ${price} €`)
  return { price, in_stock:true }
}

// ===== Browser ultrarrápido =====
async function fetchWithBrowserUltra(url, kind, { enableJS=false } = {}){
  const browser = await chromium.launch({
    headless: HEADFUL ? false : true,
    args: ["--no-sandbox","--disable-dev-shm-usage"]
  })
  // bloqueamos recursos pesados
  const context = await browser.newContext({
    userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    viewport:{ width:1366, height:900 },
    locale:"es-ES",
    timezoneId:"Europe/Madrid",
    extraHTTPHeaders:{ "Accept-Language":"es-ES,es;q=0.9,en;q=0.8" },
    javaScriptEnabled: enableJS, // primero false (rápido); si falla, reintento true
  })
  const page = await context.newPage()

  await page.route("**/*", (route) => {
    const r = route.request()
    const type = r.resourceType()
    if (["image","media","font","stylesheet"].includes(type)) return route.abort()
    return route.continue()
  })

  try{
    log.step(`Browser ${enableJS? "(JS ON)":"(JS OFF)"} → ${url}`)
    await page.goto(url,{ waitUntil:"domcontentloaded", timeout:60000 })
    // intenta aceptar cookies si aparece
    const consent = [
      '#onetrust-accept-btn-handler',
      'button#onetrust-accept-btn-handler',
      'button:has-text("Aceptar")',
      'button:has-text("Aceptar todas")',
      'button:has-text("ACEPTAR")'
    ]
    for (const sel of consent){
      const el = page.locator(sel).first()
      if ((await el.count())>0){ await el.click({timeout:1200}).catch(()=>{}); break }
    }

    if (kind==="amazon"){
      // con JS OFF puede no hidratar, pero a menudo el HTML trae el precio igualmente
      const priceText = await page.locator("span.a-offscreen").first().textContent({timeout:6000}).catch(()=>null)
      let price = parsePrice(priceText)
      // extracción de imágenes con HTML crudo (JS NO necesario)
      const html = await page.content()
      const images = extractAmazonImages(html)

      // si NO hay precio y JS estaba OFF → reintenta con JS ON
      if (!Number.isFinite(price) && !enableJS){
        await browser.close()
        return await fetchWithBrowserUltra(url, kind, { enableJS:true })
      }

      await browser.close()
      if(Number.isFinite(price)&&price>0){ log.info(`Amazon precio Browser: ${price} € | imágenes: ${images.length}`); return { price, in_stock:true, images } }
      throw new Error("Amazon Browser no pudo extraer precio")
    }else{
      let text = await page.locator("#pdp-price-current-container").first().textContent({timeout:6000}).catch(()=>null)
      let price = parsePrice(text)
      if(!Number.isFinite(price)){
        const sel = ['[data-e2e="product-price"]', 'span[itemprop="price"]', '.price, .current-price, .product-price']
        for (const s of sel){
          const t = await page.locator(s).first().textContent({timeout:3000}).catch(()=>null)
          price = parsePrice(t)
          if (Number.isFinite(price)&&price>0) break
        }
      }
      if (!Number.isFinite(price) && !enableJS){
        await browser.close()
        return await fetchWithBrowserUltra(url, kind, { enableJS:true })
      }

      await browser.close()
      if(Number.isFinite(price)&&price>0){ log.info(`PCC precio Browser: ${price} €`); return { price, in_stock:true } }
      throw new Error("PCC Browser no pudo extraer precio")
    }
  }catch(e){
    await browser.close()
    throw e
  }
}

// ===== Router por merchant =====
async function fetchPriceForProduct(p){
  const isAmazon = /amazon\.[a-z.]+/i.test(p.url||"")
  const isPcc    = /pccomponentes\.com/i.test(p.url||"")

  if (isAmazon){
    try{ return await fetchAmazonHTTP(p.url) }
    catch(e){ log.warn(`HTTP→Browser (Amazon): ${e.message}`); return await fetchWithBrowserUltra(p.url,"amazon",{ enableJS:false }) }
  }
  if (isPcc){
    try{ return await fetchPccHTTP(p.url) }
    catch(e){ log.warn(`HTTP→Browser (PCC): ${e.message}`); return await fetchWithBrowserUltra(p.url,"pcc",{ enableJS:false }) }
  }
  throw new Error("Merchant no soportado aún")
}

// ===== Concurrencia simple =====
async function mapLimit(arr, limit, iter){
  const ret = []
  let i=0
  const run = async ()=>{
    while(i < arr.length){
      const idx = i++
      ret[idx] = await iter(arr[idx], idx)
    }
  }
  const workers = Array.from({length: Math.min(limit, arr.length)}, run)
  await Promise.all(workers)
  return ret
}

// ===== Loop principal =====
export async function scrapeAndSave(){
  log.step(`Seleccionando productos ${FORCE ? "(FORCE) " : ""}${MERCHANT ? `merchant=${MERCHANT} `:""}${LIMIT?`limit=${LIMIT} `:""}concurrency=${CONCURRENCY}`)

  let query = supabase
    .from("products")
    .select("id,name,url,merchant,image_url,last_scraped_at,active")
    .eq("active", true)

  if (MERCHANT) query = query.eq("merchant", MERCHANT)

  if (!FORCE) {
    const sinceISO = new Date(Date.now() - 24*3600*1000).toISOString()
    query = query.or(`last_scraped_at.is.null,last_scraped_at.lt.${sinceISO}`)
  }

  query = query.order("last_scraped_at", { ascending:true, nullsFirst:true })
  if (LIMIT) query = query.limit(LIMIT)

  const { data: products, error } = await query
  if (error){ log.error(`Error leyendo products: ${error.message}`); return }
  if (!products?.length){ log.info("No hay productos que cumplan el filtro."); return }

  log.info(`Analizando ${products.length} producto(s)… (paralelo=${CONCURRENCY})`)

  let ok=0
  await mapLimit(products, CONCURRENCY, async (p)=>{
    log.step(`${C.bold}${p.name}${C.reset}`)
    await supabase.from("products").update({ last_scraped_at: new Date().toISOString() }).eq("id", p.id)

    try{
      const res = await fetchPriceForProduct(p)
      const { price, in_stock, images } = res

      if (images?.length){
        await supabase.from("products").update({ image_url: images[0] }).eq("id", p.id).catch(()=>{})
      }

      const { data:last } = await supabase
        .from("price_history")
        .select("price")
        .eq("product_id", p.id)
        .order("created_at",{ ascending:false })
        .limit(1)

      const lastPrice = last?.[0]?.price ?? null
      if (lastPrice !== null && Number(lastPrice) === Number(price)){
        log.info(`Precio sin cambios (${price}€). Paso al siguiente.`)
        return
      }

      const { error: insErr } = await supabase.from("price_history").insert({
        product_id: p.id, price, in_stock, currency:"EUR"
      })
      if (insErr){ log.error(`No se pudo guardar ${p.name}: ${insErr.message}`); return }

      ok++
      log.info(`Guardado ${C.bold}${p.name}${C.reset} → ${C.magenta}${price}€${C.reset} (${in_stock? "✅ stock":"❌ sin stock"})`)
      await sleep(80)
    }catch(e){
      log.error(`Falló ${p.name}: ${e.message}`)
    }
  })

  log.info(`Scrapeo completado. Correctos nuevos: ${ok}/${products.length}`)
}

// ===== Autoejecución =====
if (process.argv[1]?.includes("rigscan.js")){
  log.step("Iniciando tarea Rigscan (Turbo)…")
  scrapeAndSave()
    .then(()=>log.info("Tarea finalizada."))
    .catch(e=>log.error(e?.stack||e?.message))
}
