import fs from 'fs'
import path from 'path'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'
import Tesseract from 'tesseract.js'
import pdf2pic from 'pdf2pic'
import { processArguments } from './args-handler.js'
import { loadProcessedRegistry, saveProcessedRegistry, getFileKey } from './file-registry.js'
import './error-handler.js' // Inicializa manejo de errores automáticamente
import { showProgress, clearProgress, showSummary, showFolderInfo } from './ui-utils.js'
import { getUniqueFilename, getPDFFiles, ensureDirectoryExists } from './file-utils.js'
const { getDocument } = pdfjs

const MAX_CONCURRENT = 5 // Limitar la concurrencia para evitar sobrecarga del sistema

let processedRegistry = new Set()
let processedFilenames = new Set()
let totalFiles = 0
let processedCount = 0

// Obtener carpetas desde argumentos de línea de comandos
const folders = processArguments()

// Configuración de conversión PDF a imagen para OCR
const PDF_TO_PIC_OPTIONS = {
  density: 100,
  saveFilename: "temp_page",
  savePath: path.join(process.cwd(), 'temp'),
  format: "png",
  width: 1024,
  height: 1448
}

// RUT/C.I. válidos para Uruguay (números de 7-8 dígitos)
const RUT_REGEX = /\b(\d{7,8})\b/g

async function extractIdentifier(text) {
  const ciMatch = text.match(/C\.I\.\s*(.*?)\s*-/)
  if (ciMatch) return ciMatch[1].trim()

  const rutMatch = text.match(/\b(\d{7,9})[-–](\d|k|K)\b/)
  if (rutMatch) return rutMatch[1] // Solo el número principal, sin el dígito verificador

  return null
}

async function extractTextFromPDF(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath))
  const pdf = await getDocument({ data }).promise

  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items.map(item => item.str).join(' ')
    fullText += text + '\n'
  }

  return fullText
}

// Función de OCR como fallback
async function extractTextWithOCR(pdfPath) {
    try {
        const convert = pdf2pic.fromPath(pdfPath, {
            density: 300,
            saveFilename: "page",
            savePath: "./temp",
            format: "png",
            width: 2000,
            height: 2000
        })
        
        const result = await convert(1, { responseType: "image" })
        
        const { data: { text } } = await Tesseract.recognize(result.path, 'spa+eng', {
            logger: () => {} // Silenciar logs del OCR para la barra de progreso
        })
        
        try {
            fs.unlinkSync(result.path)
        } catch (cleanupError) {
            // Silenciar errores de limpieza
        }
        
        return text.trim()
    } catch (error) {
        // Manejar específicamente errores de libpng y otros errores de imagen
        if (error.message && error.message.includes('libpng error') || 
            error.message && error.message.includes('CRC error') ||
            error.message && error.message.includes('IDAT') ||
            error.message && error.message.includes('RuntimeError: Aborted')) {
            // Error de imagen corrupta, continuar silenciosamente
            return ''
        }
        // Para otros errores, también devolver cadena vacía para mantener el flujo
        return ''
    }
}

function getUniqueFilename(baseDir, baseName) {
  let i = 2 // Empezar desde 2 para evitar (1)
  let filename = `${baseName}.pdf`
  let fullPath = path.join(baseDir, filename)

  while (fs.existsSync(fullPath)) {
    filename = `${baseName} (${i}).pdf`
    fullPath = path.join(baseDir, filename)
    i++
  }

  return fullPath
}

// Procesar un solo archivo
async function processFile(file, folderPath, processedFiles) {
  const fullPath = path.join(folderPath, file)
  const fileKey = `${folderPath}/${file}`
  
  // Saltar si ya fue procesado
  if (processedFiles.has(fileKey)) {
    return { skipped: true, file, reason: 'Ya procesado' }
  }

  try {
    // Intentar extracción con PDF.js primero
    const text = await extractTextFromPDF(fullPath)
    let rawId = await extractIdentifier(text)
    let id = rawId?.replace(/\D/g, '')

    // Si no se encontró con PDF.js, intentar OCR
    if (!id) {
      const ocrText = await extractTextWithOCR(fullPath)
      if (ocrText && ocrText.trim()) {
        const ocrRawId = await extractIdentifier(ocrText)
        id = ocrRawId?.replace(/\D/g, '')
      }
    }

    if (id) {
      // Marcar como procesado
      processedFiles.add(fileKey)
      return { success: true, file, id, fullPath }
    } else {
      return { failed: true, file, reason: 'No se encontró RUT/C.I.' }
    }
  } catch (error) {
    return { failed: true, file, reason: error.message }
  }
}

// Mostrar barra de progreso
function showProgress(completed, total, currentFile = '') {
  const percentage = Math.round((completed / total) * 100)
  const barLength = 30
  const filledLength = Math.round((percentage / 100) * barLength)
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength)
  
  process.stdout.write(`\r📊 Progreso: [${bar}] ${percentage}% (${completed}/${total}) ${currentFile.slice(0, 30)}...`)
}

async function renamePDFsInFolder(folderPath) {
  const allFiles = fs.readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.pdf'))
  const processedFiles = loadProcessedRegistry()
  
  console.log(`\n🔄 Procesando carpeta: ${folderPath}`)
  console.log(`📁 Total de archivos PDF: ${allFiles.length}`)
  
  // Filtrar archivos ya procesados
  const pendingFiles = allFiles.filter(file => !processedFiles.has(`${folderPath}/${file}`))
  console.log(`⏳ Archivos pendientes: ${pendingFiles.length}`)
  
  if (pendingFiles.length === 0) {
    console.log('✅ Todos los archivos ya fueron procesados')
    return
  }

  const rutMap = new Map()
  let completed = 0
  const total = pendingFiles.length

  // Procesar archivos en lotes paralelos
  for (let i = 0; i < pendingFiles.length; i += MAX_CONCURRENT) {
    const batch = pendingFiles.slice(i, i + MAX_CONCURRENT)
    
    const promises = batch.map(file => {
      showProgress(completed, total, file)
      return processFile(file, folderPath, processedFiles)
    })

    const results = await Promise.all(promises)
    
    for (const result of results) {
      completed++
      showProgress(completed, total, result.file)
      
      if (result.success) {
        const { id, file, fullPath } = result
        if (!rutMap.has(id)) rutMap.set(id, [])
        rutMap.get(id).push({ file, fullPath })
      }
    }
    
    // Guardar progreso cada lote
    saveProcessedRegistry(processedFiles)
  }

  console.log('\n')
  console.log(`✅ Procesamiento completado. Renombrando archivos...`)

  // 2. Renombrar y mover según cantidad
  let renamed = 0
  let moved = 0
  
  for (const [id, items] of rutMap.entries()) {
    if (items.length === 1) {
      // único → renombrar directamente (sin sufijo)
      const { file, fullPath } = items[0]
      const targetPath = path.join(folderPath, `${id}.pdf`)

      if (!fs.existsSync(targetPath)) {
        fs.renameSync(fullPath, targetPath)
        renamed++
        console.log(`✅ ${file} → ${id}.pdf`)
      } else {
        const newPath = getUniqueFilename(folderPath, id)
        fs.renameSync(fullPath, newPath)
        renamed++
        console.log(`⚠️ Renombrado con sufijo: ${file} → ${path.basename(newPath)}`)
      }
    } else {
      // múltiples → crear carpeta por RUT
      const targetDir = path.join(folderPath, id)
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir)

      for (const { file, fullPath } of items) {
        const targetPath = getUniqueFilename(targetDir, id)
        fs.renameSync(fullPath, targetPath)
        moved++
        console.log(`📁 ${file} → ${path.relative(folderPath, targetPath)}`)
      }
    }
  }
  
  console.log(`\n📈 Resumen de ${folderPath}:`)
  console.log(`   - Archivos renombrados: ${renamed}`)
  console.log(`   - Archivos movidos a carpetas: ${moved}`)
  console.log(`   - Total procesados exitosamente: ${renamed + moved}`)
}

// Ejecutar en cada carpeta con manejo de errores
async function main() {
  console.log('🚀 Iniciando procesamiento masivo de PDFs...')
  
  for (const folder of folders) {
    try {
      await renamePDFsInFolder(folder)
    } catch (error) {
      console.error(`❌ Error procesando carpeta ${folder}:`, error.message)
      console.log(`⚠️ Continuando con la siguiente carpeta...`)
    }
  }
  
  console.log('\n🎉 ¡Procesamiento completo terminado!')
}

main().catch(console.error)
