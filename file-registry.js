import fs from 'fs'

const REGISTRY_FILE = './processed_files.json'

// Cargar registro de archivos ya procesados
export function loadProcessedRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')))
    }
  } catch (error) {
    console.warn('⚠️ No se pudo cargar el registro de archivos procesados, empezando desde cero')
  }
  return new Set()
}

// Guardar registro de archivos procesados
export function saveProcessedRegistry(processedFiles) {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify([...processedFiles], null, 2))
  } catch (error) {
    console.warn('⚠️ No se pudo guardar el registro de archivos procesados:', error.message)
  }
}

// Generar clave única para un archivo basado en path y metadatos
export function getFileKey(filePath, stats) {
  // Crear clave única con path y tamaño del archivo
  return `${filePath}/${stats.size}/${stats.mtime.getTime()}`
}
