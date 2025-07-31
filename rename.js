import fs from 'fs'
import path from 'path'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'
const { getDocument } = pdfjs

const folders = []

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
    const fullPath = path.join(folderPath, file)
    const text = await extractTextFromPDF(fullPath)
    const rawId = await extractIdentifier(text)
    const id = rawId?.replace(/\D/g, '')

    if (id) {
      if (!rutMap.has(id)) rutMap.set(id, [])
      rutMap.get(id).push({ file, fullPath })
    } else {
      console.log(`⚠️ No se encontró C.I. ni RUT en: ${file}`)
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

// Ejecutar en cada carpeta
for (const folder of folders) {
  renamePDFsInFolder(folder)
}
