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
let failedFiles = [] // Lista de archivos que fallaron en el procesamiento
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

// Extraer identificador RUT/C.I. del texto (sin dígito verificador)
function extractIdentifier(text) {
  if (!text || text.trim().length === 0) return null
  
  const rutMatch = text.match(RUT_REGEX)
  if (rutMatch) {
    return rutMatch[0] // Primer match encontrado
  }
  return null
}

// Extraer texto usando PDF.js
async function extractTextWithPDFJS(pdfPath) {
  try {
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
  } catch (error) {
    return '' // En caso de error, devolver texto vacío
  }
}

// Extraer texto usando OCR como fallback
async function extractTextWithOCR(pdfPath) {
  try {
    ensureDirectoryExists(PDF_TO_PIC_OPTIONS.savePath)
    
    const convert = pdf2pic.fromPath(pdfPath, PDF_TO_PIC_OPTIONS)
    const result = await convert(1, { responseType: "image" })
    
    // Verificar que el archivo de imagen se creó correctamente
    if (!result.path || !fs.existsSync(result.path)) {
      return ''
    }
    
    const { data: { text } } = await Tesseract.recognize(result.path, 'spa+eng', {
      logger: () => {}, // Silenciar logs del OCR
      errorHandler: () => {} // Silenciar errores del OCR
    })
    
    // Limpiar archivo temporal
    try {
      fs.unlinkSync(result.path)
    } catch (cleanupError) {
      // Ignorar errores de limpieza
    }
    
    return text.trim()
  } catch (error) {
    // Silenciar errores específicos de libpng y setThrew
    if (!error.message.includes('libpng') && !error.message.includes('setThrew')) {
      console.warn(`⚠️ OCR error for ${path.basename(pdfPath)}: ${error.message}`)
    }
    return '' // En caso de error, devolver texto vacío
  }
}

// Procesar un archivo PDF individual  
async function processFile(filePath) {
  const stats = fs.statSync(filePath)
  const fileKey = getFileKey(filePath, stats)
  
  // Verificar si ya fue procesado
  if (processedRegistry.has(fileKey)) {
    processedCount++
    return { processed: true, renamed: false, error: false }
  }

  const fileName = path.basename(filePath)
  showProgress(processedCount + 1, totalFiles, fileName)

  try {
    // Intentar extracción con PDF.js primero
    let extractedText = await extractTextWithPDFJS(filePath)
    let identifier = extractIdentifier(extractedText)
    
    // Si PDF.js no encuentra texto, usar OCR como fallback
    if (!identifier && extractedText.trim().length < 50) {
      try {
        extractedText = await extractTextWithOCR(filePath)
        identifier = extractIdentifier(extractedText)
      } catch (ocrError) {
        // Si OCR falla, continuar sin él
        identifier = null
      }
    }

    if (identifier) {
      const directory = path.dirname(filePath)
      const newFileName = `${identifier}.pdf`
      const newPath = getUniqueFilename(directory, identifier, '.pdf')
      
      // Verificar que no renombre a un archivo que ya existe
      if (processedFilenames.has(newFileName)) {
        processedRegistry.add(fileKey)
        processedCount++
        failedFiles.push({ file: fileName, reason: 'Nombre duplicado' })
        return { processed: true, renamed: false, error: false }
      }

      fs.renameSync(filePath, newPath)
      processedFilenames.add(newFileName)
      processedRegistry.add(fileKey)
      processedCount++
      return { processed: true, renamed: true, error: false }
    } else {
      processedRegistry.add(fileKey)
      processedCount++
      failedFiles.push({ file: fileName, reason: 'No se encontró RUT válido' })
      return { processed: true, renamed: false, error: false }
    }
  } catch (error) {
    processedCount++
    failedFiles.push({ file: fileName, reason: `Error: ${error.message}` })
    return { processed: true, renamed: false, error: true }
  }
}

// Procesar todos los PDFs en una carpeta usando procesamiento en paralelo
async function renamePDFsInFolder(folderPath) {
  const files = getPDFFiles(folderPath)
  
  if (files.length === 0) {
    console.log(`❌ No se encontraron archivos PDF en: ${folderPath}`)
    return
  }

  // Cargar registro de archivos procesados
  processedRegistry = loadProcessedRegistry()
  
  // En la primera ejecución (registro vacío), procesar todos los archivos
  // En ejecuciones posteriores, solo archivos no procesados
  const pendingFiles = processedRegistry.size === 0 ? files : files.filter(file => {
    const fullPath = path.join(folderPath, file)
    const stats = fs.statSync(fullPath)
    const fileKey = getFileKey(fullPath, stats)
    return !processedRegistry.has(fileKey)
  })

  showFolderInfo(folderPath, files.length, pendingFiles.length)
  
  if (pendingFiles.length === 0) {
    console.log('✅ Todos los archivos ya fueron procesados')
    return
  }
  
  totalFiles = pendingFiles.length
  processedCount = 0
  failedFiles = [] // Reiniciar lista de archivos fallidos para esta carpeta
  
  let renamedCount = 0
  let errorCount = 0

  // Procesar archivos en lotes para controlar la concurrencia
  for (let i = 0; i < pendingFiles.length; i += MAX_CONCURRENT) {
    const batch = pendingFiles.slice(i, i + MAX_CONCURRENT)
    const promises = batch.map(file => processFile(path.join(folderPath, file)))
    
    const results = await Promise.all(promises)
    
    // Contar resultados
    results.forEach(result => {
      if (result.renamed) renamedCount++
      if (result.error) errorCount++
    })
  }

  // Guardar registro actualizado
  saveProcessedRegistry(processedRegistry)
  
  // Mostrar resumen
  showSummary(path.basename(folderPath), renamedCount, 0)
  
  // Mostrar archivos fallidos si los hay
  if (failedFiles.length > 0) {
    console.log(`\n❌ Archivos que no se pudieron procesar (${failedFiles.length}):`)
    failedFiles.forEach((failed, index) => {
      console.log(`   ${index + 1}. ${failed.file} - ${failed.reason}`)
    })
  }
}

// Función principal
async function main() {
  console.log('🚀 Iniciando procesamiento de PDFs...')
  
  // Silenciar errores específicos de libpng y setThrew
  const originalConsoleError = console.error
  console.error = (...args) => {
    const message = args.join(' ')
    if (message.includes('libpng error') || 
        message.includes('missing function: setThrew') || 
        message.includes('Aborted(-1)')) {
      return // Silenciar estos errores específicos
    }
    originalConsoleError.apply(console, args)
  }
  
  if (folders.length === 0) {
    console.log('❌ No se especificaron carpetas válidas')
    process.exit(1)
  }

  for (const folder of folders) {
    await renamePDFsInFolder(folder)
  }

  console.log('✅ Procesamiento completado')
}

// Ejecutar programa principal
main().catch(error => {
  console.error('❌ Error fatal:', error.message)
  process.exit(1)
})
