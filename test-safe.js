import fs from 'fs'
import path from 'path'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'
const { getDocument } = pdfjs

const folders = []

// Lista de archivos problemáticos conocidos que debemos saltar
const problematicFiles = [
    'img20250731_15575988.pdf',
    '16546764 (rep).pdf'
]

async function extractIdentifier(text) {
  const ciMatch = text.match(/C\.I\.\s*(.*?)\s*-/)
  if (ciMatch) return ciMatch[1].trim()

  const rutMatch = text.match(/\b(\d{7,9})[-–](\d|k|K)\b/)
  if (rutMatch) return `${rutMatch[1]}${rutMatch[2]}`

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

async function testProcessing() {
  let totalFiles = 0
  let processedFiles = 0
  let skippedFiles = 0
  let foundIds = 0

  for (const folder of folders) {
    console.log(`\n=== Procesando carpeta: ${folder} ===`)
    const files = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.pdf'))
    totalFiles += files.length

    for (const file of files) {
      // Saltar archivos problemáticos conocidos
      if (problematicFiles.includes(file)) {
        console.log(`⏭️ Saltando archivo problemático: ${file}`)
        skippedFiles++
        continue
      }

      try {
        const fullPath = path.join(folder, file)
        const text = await extractTextFromPDF(fullPath)
        const rawId = await extractIdentifier(text)
        const id = rawId?.replace(/\D/g, '')

        if (id) {
          console.log(`✅ ${file} → ID encontrado: ${id}`)
          foundIds++
        } else {
          console.log(`⚠️ ${file} → No se encontró ID`)
        }
        processedFiles++
      } catch (error) {
        console.error(`❌ Error procesando ${file}:`, error.message)
        skippedFiles++
      }
    }
  }

  console.log(`\n=== RESUMEN ===`)
  console.log(`Total de archivos: ${totalFiles}`)
  console.log(`Archivos procesados: ${processedFiles}`)
  console.log(`Archivos saltados/error: ${skippedFiles}`)
  console.log(`IDs encontrados: ${foundIds}`)
  console.log(`Tasa de éxito: ${((foundIds / processedFiles) * 100).toFixed(1)}%`)
}

testProcessing().catch(console.error)
