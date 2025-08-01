import fs from 'fs'
import path from 'path'

// Generar nombre de archivo único
export function getUniqueFilename(baseDir, baseName) {
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

// Obtener archivos PDF de una carpeta
export function getPDFFiles(folderPath) {
  return fs.readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.pdf'))
}

// Crear directorio si no existe
export function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}
