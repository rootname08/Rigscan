// packages/tools/make_seed_csv.js
// -------------------------------------------------------------
// Crea/actualiza data/products_seed.csv con 100 productos gaming.
// Permite añadir más con:  npm run seed -- --add data/mis_extra.csv
// Logs ANSI: [INFO] [*] [ERROR]
// -------------------------------------------------------------
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const C = { reset:"\x1b[0m", green:"\x1b[32m", cyan:"\x1b[36m", red:"\x1b[31m", yellow:"\x1b[33m", bold:"\x1b[1m" }
const log = {
  info: (m)=>console.log(`${C.green}[INFO]${C.reset} ${m}`),
  step: (m)=>console.log(`${C.cyan}[*]${C.reset} ${m}`),
  warn: (m)=>console.log(`${C.yellow}[WARN]${C.reset} ${m}`),
  error: (m)=>console.error(`${C.red}[ERROR]${C.reset} ${m}`),
}

// ========== rutas ==========
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, "../../data")
const CSV_PATH = path.join(DATA_DIR, "products_seed.csv")

// ========== utilidades CSV ==========
const HEADER = ["name","category","merchants"]

function toCSVRow(row) {
  const esc = (s="") => {
    const v = String(s)
    return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v
  }
  return HEADER.map(h => esc(row[h] ?? "")).join(",")
}
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  const header = lines.shift()?.split(",") || []
  const rows = []
  for (const line of lines) {
    // parser simple (no comillas anidadas complejas)
    const cells = line.split(",")
    const obj = {}
    header.forEach((k, i) => obj[k] = (cells[i] ?? "").trim())
    if (obj.name && obj.category) rows.push(obj)
  }
  return rows
}
function dedupRows(rows) {
  const key = (r) => `${r.name.toLowerCase()}|${r.category.toLowerCase()}`
  const map = new Map()
  for (const r of rows) {
    // normaliza merchants
    const merchants = (r.merchants || "amazon,pccomponentes")
      .split(/\s*,\s*/).filter(Boolean)
      .map(m => m.toLowerCase())
    const clean = { name: r.name.trim(), category: r.category.trim().toLowerCase(), merchants: merchants.join(",") }
    map.set(key(clean), clean)
  }
  return Array.from(map.values())
}

// ========== datos base (100 productos) ==========
const BASE = [
  // mouse
  ["Logitech G Pro X Superlight 2","mouse"],
  ["Razer DeathAdder V3 Pro","mouse"],
  ["SteelSeries Aerox 5 Wireless","mouse"],
  ["Glorious Model O Wireless","mouse"],
  ["HyperX Pulsefire Haste 2 Wireless","mouse"],
  ["Logitech G305 Lightspeed","mouse"],
  ["Razer Basilisk V3 Pro","mouse"],
  ["Corsair M75 Wireless","mouse"],
  ["Zowie EC2-CW","mouse"],
  ["ASUS ROG Keris Wireless AimPoint","mouse"],
  ["SteelSeries Prime Wireless","mouse"],
  ["Logitech G502 X Lightspeed","mouse"],
  ["Razer Viper V3 Pro","mouse"],
  ["Endgame Gear XM2we","mouse"],
  ["Cooler Master MM731","mouse"],
  // keyboard
  ["Logitech G Pro Keyboard (TKL)","keyboard"],
  ["Razer Huntsman V2","keyboard"],
  ["SteelSeries Apex Pro TKL (OmniPoint)","keyboard"],
  ["Keychron K2 V2 (Hot-swap)","keyboard"],
  ["Corsair K70 RGB Pro","keyboard"],
  ["Ducky One 3 TKL","keyboard"],
  ["Logitech G915 TKL (wireless)","keyboard"],
  ["Razer BlackWidow V4","keyboard"],
  ["Mountain Everest 60","keyboard"],
  ["ASUS ROG Strix Scope II 96","keyboard"],
  // headsets
  ["SteelSeries Arctis Nova Pro Wireless","headset"],
  ["HyperX Cloud III","headset"],
  ["Logitech G Pro X 2 Lightspeed","headset"],
  ["Razer BlackShark V2 Pro 2023","headset"],
  ["Corsair HS80 RGB Wireless","headset"],
  ["Sony INZONE H9","headset"],
  ["SteelSeries Arctis Nova 7","headset"],
  ["EPOS H6PRO","headset"],
  ["Beyerdynamic MMX 300 (2nd Gen)","headset"],
  ["Cooler Master MH752","headset"],
  // microphones
  ["Shure SM7B","microphone"],
  ["Elgato Wave:3","microphone"],
  ["HyperX QuadCast S","microphone"],
  ["Blue Yeti X","microphone"],
  ["Rode NT1 5th Gen","microphone"],
  ["Rode PodMic","microphone"],
  ["Razer Seiren V2 Pro","microphone"],
  ["Audio-Technica AT2020USB+","microphone"],
  ["Elgato Wave DX","microphone"],
  // controllers
  ["Sony DualSense (PS5)","controller"],
  ["Xbox Wireless Controller (Series)","controller"],
  ["8BitDo Pro 2","controller"],
  ["SCUF Instinct Pro","controller"],
  ["Razer Wolverine V2 Chroma","controller"],
  ["Nacon Revolution Unlimited","controller"],
  ["Victrix Pro BFG","controller"],
  ["Logitech F310","controller"],
  ["PowerA Enhanced Wired","controller"],
  ["ASUS ROG Raikiri Pro","controller"],
  // mousepads
  ["Logitech G640 (Large)","mousepad"],
  ["Artisan Zero XSoft (XL)","mousepad"],
  ["SteelSeries QcK Heavy (XXL)","mousepad"],
  ["Zowie G-SR-SE (Deep Blue)","mousepad"],
  ["Glorious XXL Stealth","mousepad"],
  ["Razer Gigantus V2 (L)","mousepad"],
  ["Endgame Gear MPC450","mousepad"],
  ["SkyPAD 3.0 (Glass)","mousepad"],
  ["Lethal Gaming Gear Saturn Pro","mousepad"],
  ["Corsair MM700 RGB Extended","mousepad"],
  // monitors
  ["BenQ Zowie XL2546K (240Hz)","monitor"],
  ["AOC 24G2SP (165Hz)","monitor"],
  ["LG 27GP850-B (180Hz)","monitor"],
  ["Gigabyte M27Q P (170Hz)","monitor"],
  ["ASUS TUF VG27AQ","monitor"],
  ["Samsung Odyssey G7 27\"","monitor"],
  ["MSI MAG 274QRF-QD","monitor"],
  ["Alienware AW2725DF (360Hz)","monitor"],
  ["Iiyama GB2770QSU","monitor"],
  ["Philips 27M1N5500","monitor"],
  // webcams
  ["Logitech StreamCam","webcam"],
  ["Elgato Facecam Pro","webcam"],
  ["Razer Kiyo Pro","webcam"],
  ["Sony ZV-E10 (creator kit)","webcam"],
  ["Dell Ultrasharp Webcam","webcam"],
  ["AverMedia PW513","webcam"],
  ["Insta360 Link","webcam"],
  ["OBSbot Tiny 2","webcam"],
  ["NexiGo N930AF","webcam"],
  ["Logitech C920 HD Pro","webcam"],
  // streaming
  ["Elgato Stream Deck MK.2","streaming"],
  ["Loupedeck Live S","streaming"],
  ["Elgato Key Light","streaming"],
  ["Elgato Cam Link 4K","streaming"],
  ["AverMedia Live Gamer Mini","streaming"],
  ["Rode PSA1+ (boom arm)","streaming"],
  ["Elgato Wave XLR","streaming"],
  ["GoXLR Mini","streaming"],
  ["FIFINE K688","microphone"],
  ["NZXT Function MiniTKL","keyboard"]
]

// ========== genera base ==========
function baseRows() {
  return BASE.map(([name, category]) => ({
    name,
    category,
    merchants: "amazon,pccomponentes"
  }))
}

// ========== merge con CSV existente / con --add ==========
function loadExisting(csvPath) {
  if (!fs.existsSync(csvPath)) return []
  const text = fs.readFileSync(csvPath, "utf-8")
  return parseCSV(text)
}
function loadAddArg() {
  const idx = process.argv.indexOf("--add")
  if (idx === -1) return []
  const addPath = process.argv[idx + 1]
  if (!addPath) {
    log.warn("Usaste --add pero no pasaste ruta. Ej: --add data/mis_extra.csv")
    return []
  }
  if (!fs.existsSync(addPath)) {
    log.error(`No existe: ${addPath}`)
    return []
  }
  log.step(`Cargando extra: ${addPath}`)
  return parseCSV(fs.readFileSync(addPath, "utf-8"))
}

// ========== main ==========
function writeCSV(rows, csvPath) {
  const out = [HEADER.join(",")]
  for (const r of rows) out.push(toCSVRow(r))
  fs.writeFileSync(csvPath, out.join("\n"), "utf-8")
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function main() {
  ensureDir(DATA_DIR)

  log.step(`Generando base (100 productos)…`)
  let rows = baseRows()

  const existing = loadExisting(CSV_PATH)
  if (existing.length) {
    log.info(`Encontrado CSV existente (${existing.length} filas). Fusionando sin duplicar…`)
    rows = rows.concat(existing)
  }

  const extra = loadAddArg()
  if (extra.length) {
    log.info(`Añadiendo extras (${extra.length} filas)…`)
    rows = rows.concat(extra)
  }

  rows = dedupRows(rows)
  rows.sort((a,b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  writeCSV(rows, CSV_PATH)
  log.info(`CSV listo: ${CSV_PATH}`)
  log.step(`Para añadir más: crea un CSV con columnas "name,category,merchants" y ejecuta:`)
  console.log(`${C.bold}npm run seed -- --add ruta/de/tu.csv${C.reset}`)
}

main()
