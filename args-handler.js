import fs from 'fs'

/**
 * Valida y procesa los argumentos de línea de comandos
 * @returns {string[]} Array de carpetas válidas
 */
export function processArguments() {
  // Obtener carpetas desde argumentos de línea de comandos
  const folders = process.argv.slice(2)
  
  // Validar que se proporcionaron carpetas
  if (folders.length === 0) {
    console.error('❌ Error: Debes especificar al menos una carpeta como argumento')
    console.log('📋 Uso: node rename-parallel.js <carpeta1> [carpeta2] [carpeta3] ...')
    console.log('📋 Ejemplo: node rename-parallel.js ./EME ./ESERT')
    process.exit(1)
  }

  // Validar que las carpetas existen
  for (const folder of folders) {
    if (!fs.existsSync(folder)) {
      console.error(`❌ Error: La carpeta "${folder}" no existe`)
      process.exit(1)
    }
    if (!fs.statSync(folder).isDirectory()) {
      console.error(`❌ Error: "${folder}" no es una carpeta`)
      process.exit(1)
    }
  }

  console.log(`🎯 Carpetas a procesar: ${folders.join(', ')}`)
  return folders
}
