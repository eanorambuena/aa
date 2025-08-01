// Utilidades para mostrar progreso y UI

// Mostrar barra de progreso
export function showProgress(completed, total, currentFile = '') {
  const percentage = Math.round((completed / total) * 100)
  const barLength = 30
  const filledLength = Math.round((percentage / 100) * barLength)
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength)
  
  const fileName = currentFile.length > 30 ? currentFile.slice(0, 27) + '...' : currentFile
  process.stdout.write(`\r📊 Progreso: [${bar}] ${percentage}% (${completed}/${total}) ${fileName}`)
}

// Limpiar la línea de progreso
export function clearProgress() {
  process.stdout.write('\r' + ' '.repeat(80) + '\r')
}

// Mostrar resumen de procesamiento
export function showSummary(folderPath, renamed, moved) {
  console.log(`\n📈 Resumen de ${folderPath}:`)
  console.log(`   - Archivos renombrados: ${renamed}`)
  console.log(`   - Archivos movidos a carpetas: ${moved}`)
  console.log(`   - Total procesados exitosamente: ${renamed + moved}`)
}

// Mostrar información inicial de carpeta
export function showFolderInfo(folderPath, totalFiles, pendingFiles) {
  console.log(`\n🔄 Procesando carpeta: ${folderPath}`)
  console.log(`📁 Total de archivos PDF: ${totalFiles}`)
  console.log(`⏳ Archivos pendientes: ${pendingFiles}`)
}
