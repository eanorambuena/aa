import fs from 'fs'
import path from 'path'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'
import Tesseract from 'tesseract.js'
import pdf2pic from 'pdf2pic'
const { getDocument } = pdfjs

const folders = []

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
async function extractTextWithOCR(filePath) {
    try {
        console.log(`Intentando OCR en ${path.basename(filePath)}...`)
        
        const convert = pdf2pic.fromPath(filePath, {
            density: 300,
            saveFilename: "page",
            savePath: "./temp",
            format: "png",
            width: 2000,
            height: 2000
        })
        
        const result = await convert(1, { responseType: "image" })
        
        const { data: { text } } = await Tesseract.recognize(result.path, 'spa+eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    console.log(`OCR progreso: ${Math.round(m.progress * 100)}%`)
                }
            }
        })
        
        try {
            fs.unlinkSync(result.path)
        } catch (cleanupError) {
            console.warn('No se pudo limpiar archivo temporal:', cleanupError.message)
        }
        
        return text.trim()
    } catch (error) {
        // Manejo específico para errores de imagen corrupta
        if (error.message.includes('libpng error') || 
            error.message.includes('CRC error') || 
            error.message.includes('bad adaptive filter') ||
            error.message.includes('Aborted(-1)')) {
            console.error(`❌ Imagen PNG corrupta en ${path.basename(filePath)}:`, error.message)
        } else {
            console.error(`❌ Error en OCR para ${path.basename(filePath)}:`, error.message)
        }
        return ''
    }
}

function getUniqueFilename(baseDir, baseName) {
  let i = 1
  let filename = `${baseName}.pdf`
  let fullPath = path.join(baseDir, filename)

  while (fs.existsSync(fullPath)) {
    i++
    filename = `${baseName} (${i}).pdf`
    fullPath = path.join(baseDir, filename)
  }

  return fullPath
}

async function renamePDFsInFolder(folderPath) {
  const files = fs.readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.pdf'))

  const rutMap = new Map()

  // 1. Agrupar por RUT
  for (const file of files) {
    try {
      const fullPath = path.join(folderPath, file)
      const text = await extractTextFromPDF(fullPath)
      const rawId = await extractIdentifier(text)
      const id = rawId?.replace(/\D/g, '')

      if (id) {
        if (!rutMap.has(id)) rutMap.set(id, [])
        rutMap.get(id).push({ file, fullPath })
      } else {
        console.log(`⚠️ No se encontró C.I. ni RUT con PDF parser en: ${file}. Intentando OCR...`)
        // Intentar OCR como fallback con manejo robusto de errores
        try {
          const ocrText = await extractTextWithOCR(fullPath)
          if (ocrText && ocrText.trim()) {
            const ocrRawId = await extractIdentifier(ocrText)
            const ocrId = ocrRawId?.replace(/\D/g, '')
            
            if (ocrId) {
              if (!rutMap.has(ocrId)) rutMap.set(ocrId, [])
              rutMap.get(ocrId).push({ file, fullPath })
              console.log(`✅ OCR encontró ID: ${ocrId} en ${file}`)
            } else {
              console.log(`⚠️ No se encontró C.I. ni RUT ni con OCR en: ${file}`)
            }
          } else {
            console.log(`⚠️ OCR no pudo extraer texto de: ${file}`)
          }
        } catch (ocrError) {
          // Capturar cualquier error del OCR
          if (ocrError.message.includes('libpng error') || 
              ocrError.message.includes('CRC error') || 
              ocrError.message.includes('bad adaptive filter') ||
              ocrError.message.includes('Aborted(-1)') ||
              ocrError.message.includes('RuntimeError')) {
            console.error(`❌ Archivo con imagen corrupta: ${file}`)
          } else {
            console.error(`❌ Error en OCR para ${file}:`, ocrError.message)
          }
          console.log(`⚠️ No se pudo procesar ${file} con ningún método`)
        }
      }
    } catch (fileError) {
      console.error(`❌ Error procesando archivo ${file}:`, fileError.message)
      console.log(`⚠️ Saltando archivo ${file} y continuando...`)
    }
  }

  // 2. Renombrar y mover según cantidad
  for (const [id, items] of rutMap.entries()) {
    if (items.length === 1) {
      // único → renombrar directamente
      const { file, fullPath } = items[0]
      const targetPath = path.join(folderPath, `${id}.pdf`)

      if (!fs.existsSync(targetPath)) {
        fs.renameSync(fullPath, targetPath)
        console.log(`✅ ${file} → ${id}.pdf`)
      } else {
        const newPath = getUniqueFilename(folderPath, id)
        fs.renameSync(fullPath, newPath)
        console.log(`⚠️ Renombrado con sufijo: ${file} → ${path.basename(newPath)}`)
      }
    } else {
      // múltiples → crear carpeta por RUT
      const targetDir = path.join(folderPath, id)
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir)

      for (const { file, fullPath } of items) {
        const targetPath = getUniqueFilename(targetDir, id)
        fs.renameSync(fullPath, targetPath)
        console.log(`📁 ${file} → ${path.relative(folderPath, targetPath)}`)
      }
    }
  }
}

// Ejecutar en cada carpeta con manejo de errores
for (const folder of folders) {
  try {
    console.log(`\n🔄 Procesando carpeta: ${folder}`)
    await renamePDFsInFolder(folder)
    console.log(`✅ Completado: ${folder}`)
  } catch (error) {
    console.error(`❌ Error procesando carpeta ${folder}:`, error.message)
    console.log(`⚠️ Continuando con la siguiente carpeta...`)
  }
}
