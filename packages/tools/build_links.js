// packages/tools/build_links.js
// -------------------------------------------------------------
// Lee data/products_seed.csv → busca URLs en Amazon.es y PCComponentes
// Inserta en product_staging (Supabase) con imagen principal de Amazon
// Flags:
//   --limit N  → procesa solo N filas (prueba rápida)
//   --debug    → logs extra (merchants por fila, etc.)
// Logs ANSI [INFO] [*] [WARN] [ERROR]
// -------------------------------------------------------------
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"

const C = { reset:"\x1b[0m", bold:"\x1b[1m", green:"\x1b[32m", cyan:"\x1b[36m", yellow:"\x1b[33m", red:"\x1b[31m", gray:"\x1b[90m" }
const log = {
  info: (m)=>console.log(`${C.green}[INFO]${C.reset} ${m}`),
  step: (m)=>console.log(`${C.cyan}[*]${C.reset} ${m}`),
  warn: (m)=>console.log(`${C.yellow}[WARN]${C.reset} ${m}`),
  error: (m)=>console.error(`${C.red}[ERROR]${C.reset} ${m}`),
  dbg: (m)=>console.log(`${C.gray}[DBG]${C.reset} ${m}`)
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, "../../apps/web/.env.local") })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  log.error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local")
  process.exit(1)
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const SEED = path.resolve(__dirname, "../../data/products_seed.csv")

const ARGS = process.argv.slice(2)
const limitIdx = ARGS.indexOf("--limit")
const LIMIT = limitIdx !== -1 ? Number(ARGS[limitIdx + 1]) || 0 : 0
const DEBUG = ARGS.includes("--debug")

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  const header = lines.shift()?.split(",") || []
  const idxName = header.indexOf("name")
  const idxCat = header.indexOf("category")
  const idxMer = header.indexOf("merchants")
  const rows = []
  for (const line of lines) {
    // parser simple
    const cells = line.split(",")
    const name = (cells[idxName] || "").trim()
    const category = (cells[idxCat] || "").trim()
    const merchants = (cells[idxMer] || "").trim()
    if (name && category) rows.push({ name, category, merchants })
  }
  return rows
}

function dedupRows(rows) {
  const key = (r) => `${r.name.toLowerCase()}|${r.category.toLowerCase()}`
  const map = new Map()
  for (const r of rows) {
    let merchants = r.merchants && r.merchants.length ? r.merchants : "amazon,pccomponentes"
    merchants = merchants.split(/\s*,\s*/).filter(Boolean).map(m => m.toLowerCase()).join(",")
    map.set(key(r), { name: r.name.trim(), category: r.category.trim().toLowerCase(), merchants })
  }
  return Array.from(map.values())
}

async function http(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache"
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

/* ---------- AMAZON ---------- */
function extractAmazonFirstResult(html) {
  let m = html.match(/<a[^>]*class=["'][^"']*a-link-normal[^"']*s-no-outline[^"']*["'][^>]*href=["']([^"']+)["']/i)
  if (m?.[1]) return new URL(m[1], "https://www.amazon.es").toString()
  m = html.match(/<a[^>]*href=["'](\/dp\/[A-Z0-9]{10}[^"']*)["']/i)
  if (m?.[1]) return new URL(m[1], "https://www.amazon.es").toString()
  m = html.match(/<a[^>]*href=["'](\/gp\/slredirect\/[^"']+)["'][^>]*>/i)
  if (m?.[1]) return new URL(m[1], "https://www.amazon.es").toString()
  return null
}
function extractAmazonImages(html) {
  const m = html.match(/id=["']landingImage["'][\s\S]*?data-a-dynamic-image=["']([^"']+)["']/i)
  if (!m?.[1]) return []
  try {
    const json = JSON.parse(m[1].replace(/&quot;/g, '"'))
    return Object.keys(json).slice(0, 3)
  } catch { return [] }
}
async function findAmazon(name) {
  const q = encodeURIComponent(name)
  const url = `https://www.amazon.es/s?k=${q}`
  log.step(`Amazon search → ${url}`)
  const html = await http(url)
  const first = extractAmazonFirstResult(html)
  if (!first) return { url: null, images: [] }
  log.info(`Amazon 1º resultado: ${first}`)
  const pdp = await http(first)
  const images = extractAmazonImages(pdp)
  if (images.length) log.info(`Amazon imágenes: ${images.length}`)
  return { url: first, images }
}

/* ---------- PCComponentes ---------- */
function extractPccFirstResult(html) {
  let m =
    html.match(/<a\s+class="c-product-card__title-link"[^>]*href="([^"]+)"/i) ||
    html.match(/<a\s+class="product-card__title"[^>]*href="([^"]+)"/i) ||
    html.match(/<a\s+href="(\/[^"]+)"[^>]*data-event-label="product"/i)
  if (!m?.[1]) return null
  return m[1].startsWith("http") ? m[1] : `https://www.pccomponentes.com${m[1]}`
}
async function findPcc(name) {
  const q = encodeURIComponent(name)
  const url = `https://www.pccomponentes.com/buscar/?query=${q}`
  log.step(`PCC search   → ${url}`)
  const html = await http(url)
  const first = extractPccFirstResult(html)
  if (first) log.info(`PCC 1º resultado: ${first}`)
  return first
}

/* ---------- Supabase staging ---------- */
async function upsertStagingRow({ name, category, merchant, url, image_url }) {
  const { error } = await supabase.from("product_staging").insert({
    name,
    url,
    image_url: image_url || null,
    merchant,
    category,
    active: true
  })
  if (error) log.error(`Staging insert error (${merchant}): ${error.message}`)
  return !error
}

async function run() {
  if (!fs.existsSync(SEED)) {
    log.error(`No existe ${SEED}. Primero ejecuta: npm run seed`)
    process.exit(1)
  }
  const raw = fs.readFileSync(SEED, "utf-8")
  let rows = dedupRows(parseCSV(raw))
  if (LIMIT > 0) rows = rows.slice(0, LIMIT)

  log.info(`Semilla a procesar: ${rows.length} filas${LIMIT ? ` (limit=${LIMIT})` : ""}`)

  let ins = 0, aOk=0, pOk=0, aFail=0, pFail=0
  for (const r of rows) {
    const name = r.name
    const category = r.category || "gaming"
    const merchants = (r.merchants || "amazon,pccomponentes").split(/\s*,\s*/).map(s=>s.trim().toLowerCase()).filter(Boolean)

    log.step(`${C.bold}${name}${C.reset} [${category}]`)
    if (DEBUG) log.dbg(`merchants = [${merchants.join(", ")}]`)

    let amazonUrl = null, amazonImgs = []

    if (merchants.includes("amazon")) {
      try {
        const a = await findAmazon(name)
        amazonUrl = a.url; amazonImgs = a.images || []
        if (amazonUrl) {
          const ok = await upsertStagingRow({
            name, category, merchant: "amazon", url: amazonUrl, image_url: amazonImgs[0] || null
          })
          if (ok) { ins++; aOk++ }
        } else { aFail++ ; log.warn("Amazon sin resultado") }
      } catch (e) { aFail++; log.warn(`Amazon fallo: ${e.message}`) }
    } else if (DEBUG) {
      log.dbg("Amazon saltado (no está en merchants)")
    }

    if (merchants.includes("pccomponentes")) {
      try {
        const pccUrl = await findPcc(name)
        if (pccUrl) {
          const ok = await upsertStagingRow({
            name, category, merchant: "pccomponentes", url: pccUrl, image_url: amazonImgs[0] || null
          })
          if (ok) { ins++; pOk++ }
        } else { pFail++; log.warn("PCC sin resultado") }
      } catch (e) { pFail++; log.warn(`PCC fallo: ${e.message}`) }
    } else if (DEBUG) {
      log.dbg("PCC saltado (no está en merchants)")
    }
  }

  log.info(`RESUMEN → staging inserts: ${ins}  | Amazon OK:${aOk} Fail:${aFail}  | PCC OK:${pOk} Fail:${pFail}`)
  log.step("➡️  En Supabase → SQL Editor ejecuta:  select * from upsert_products_from_staging();")
}

run().catch((e) => log.error(e?.stack || e?.message))
