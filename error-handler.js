// Configurar supresión de warnings y manejo de errores

// Suprimir warnings de PDF.js
const originalConsoleWarn = console.warn
console.warn = function(...args) {
  const message = args.join(' ')
  if (message.includes('fetchStandardFontData') || 
      message.includes('FoxitSerif.pfb') ||
      message.includes('baseUrl') ||
      message.includes('standardFontDataUrl') ||
      message.includes('Cannot polyfill')) {
    return // Ignorar estos warnings
  }
  originalConsoleWarn.apply(console, args)
}

// Manejadores de errores para evitar que el proceso se detenga
process.on('uncaughtException', (error) => {
  if (error.message && (error.message.includes('libpng error') || 
                       error.message.includes('CRC error') ||
                       error.message.includes('IDAT') ||
                       error.message.includes('RuntimeError: Aborted'))) {
    // Errores conocidos de imágenes corruptas - continuar silenciosamente
    return
  }
  // Para otros errores críticos, mostrar y continuar
  console.error('⚠️  Error no crítico:', error.message)
})

process.on('unhandledRejection', (reason, promise) => {
  // Manejar promesas rechazadas de manera silenciosa para errores de imagen
  if (reason && reason.message && (reason.message.includes('libpng error') || 
                                  reason.message.includes('CRC error') ||
                                  reason.message.includes('IDAT') ||
                                  reason.message.includes('RuntimeError: Aborted'))) {
    return
  }
  console.error('⚠️  Promesa rechazada:', reason)
})

// Función para verificar si un error es de imagen corrupta
export function isCorruptImageError(error) {
  if (!error || !error.message) return false
  
  return error.message.includes('libpng error') || 
         error.message.includes('CRC error') ||
         error.message.includes('IDAT') ||
         error.message.includes('RuntimeError: Aborted') ||
         error.message.includes('bad adaptive filter')
}

export function initializeErrorHandling() {
  // Esta función se puede llamar para inicializar el manejo de errores
  // Los listeners ya están configurados arriba
  console.log('🛡️  Manejo de errores inicializado')
}
