import fs from 'fs'
import path from 'path'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'
import Tesseract from 'tesseract.js'
import pdf2pic from 'pdf2pic'
const { getDocument } = pdfjs

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
        console.log(`   🔍 Intentando OCR en ${path.basename(filePath)}...`)
        
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
                    console.log(`   OCR progreso: ${Math.round(m.progress * 100)}%`)
                }
            }
        })
        
        try {
            fs.unlinkSync(result.path)
        } catch (cleanupError) {
            console.warn('   No se pudo limpiar archivo temporal:', cleanupError.message)
        }
        
        return text.trim()
    } catch (error) {
        console.error(`   ❌ Error en OCR:`, error.message)
        return ''
    }
}

async function testExtraction() {
  const folders = []
  
  console.log('🔍 Probando extracción de RUT/C.I. (sin dígito verificador):')
  
  for (const folder of folders) {
    console.log(`\n📁 Carpeta: ${folder}`)
    const files = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.pdf'))
    
    // Buscar archivos que empiecen con "img" (probablemente necesiten OCR)
    const ocrFiles = files.filter(f => f.startsWith('img')).slice(0, 3) // Solo 3 archivos OCR
    const normalFiles = files.filter(f => !f.startsWith('img')).slice(0, 2) // Solo 2 archivos normales
    
    const testFiles = [...normalFiles, ...ocrFiles]
    
    for (const file of testFiles) {
      try {
        const fullPath = path.join(folder, file)
        const text = await extractTextFromPDF(fullPath)
        const rawId = await extractIdentifier(text)
        const id = rawId?.replace(/\D/g, '')

        if (id) {
          console.log(`✅ ${file} → Archivo se nombraría: ${id}.pdf`)
          
          // Mostrar el match completo para verificar
          const rutMatch = text.match(/\b(\d{7,9})[-–](\d|k|K)\b/)
          if (rutMatch) {
            console.log(`   📋 RUT completo encontrado: ${rutMatch[0]} → Solo número: ${rutMatch[1]}`)
          }
        } else {
          console.log(`⚠️ ${file} → No se encontró RUT/C.I. con PDF parser. Probando OCR...`)
          
          // Intentar OCR
          try {
            const ocrText = await extractTextWithOCR(fullPath)
            if (ocrText && ocrText.trim()) {
              const ocrRawId = await extractIdentifier(ocrText)
              const ocrId = ocrRawId?.replace(/\D/g, '')
              
              if (ocrId) {
                console.log(`✅ ${file} → OCR encontró ID: ${ocrId} → Archivo se nombraría: ${ocrId}.pdf`)
                
                // Mostrar el match completo del OCR
                const ocrRutMatch = ocrText.match(/\b(\d{7,9})[-–](\d|k|K)\b/)
                if (ocrRutMatch) {
                  console.log(`   📋 RUT completo (OCR): ${ocrRutMatch[0]} → Solo número: ${ocrRutMatch[1]}`)
                }
              } else {
                console.log(`⚠️ ${file} → OCR no encontró RUT/C.I. válido`)
              }
            } else {
              console.log(`⚠️ ${file} → OCR no pudo extraer texto`)
            }
          } catch (ocrError) {
            console.log(`❌ ${file} → Error en OCR: ${ocrError.message}`)
          }
        }
      } catch (error) {
        console.log(`❌ ${file} → Error: ${error.message}`)
      }
    }
  }
}

testExtraction().catch(console.error)
