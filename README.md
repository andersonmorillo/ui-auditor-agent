# UI Auditor

Servidor MCP local para evaluar aplicaciones web con **Codex, Claude Code o Cursor Agent**. Reutiliza herramientas existentes y añade la organización de la auditoría y un reporte con evidencia visual.

- **[Playwright MCP](https://github.com/microsoft/playwright-mcp):** navegación, clics, formularios, teclado, pestañas, capturas, consola y solicitudes de red. Las herramientas `browser_*` provienen de Microsoft; no se reimplementan.
- **[axe-core](https://github.com/dequelabs/axe-core):** reglas de accesibilidad sobre el estado y la sesión que está explorando el agente.
- **[Lighthouse](https://github.com/GoogleChrome/lighthouse):** rendimiento de navegación, métricas y reporte original en móvil o escritorio.
- **El agente:** revisión visual y de los flujos, interpretación de evidencias, prioridades y propuestas de mejora.
- **UI Auditor:** guía de evaluación, registro persistente de evidencia y hallazgos, cobertura y reporte HTML con imágenes incorporadas.

No necesita claves de API adicionales: utiliza el agente que ya tengas conectado. El servidor no ejecuta un modelo ni empieza a auditar por sí solo; el agente dirige la exploración con sus herramientas.

![Vista del reporte de UI Auditor](docs/report-preview.png)

La imagen corresponde a una aplicación de prueba con defectos intencionales. Los reportes incluyen capturas reales, prioridades, recomendaciones y cobertura de aspectos revisados o pendientes.

## Instalación

Requisitos: Node.js 22.19 o posterior, Google Chrome y un agente local compatible con MCP. Clona este repositorio, entra en su carpeta y ejecuta:

```powershell
npm ci
npm run setup
```

`setup` crea `.mcp.json` para Claude Code y `.cursor/mcp.json` para Cursor, con las rutas absolutas de esta instalación. Conserva los otros servidores configurados y no reemplaza un `ui-auditor` que apunte a otra instalación. Estos archivos son locales y están excluidos de Git; vuelve a ejecutar setup después de mover el proyecto.

Para Codex, copia y ejecuta el comando `codex mcp add` que imprime `setup`: contiene las rutas de tu instalación. Comprueba después que el servidor aparece:

```powershell
codex mcp list
```

Fuentes: [MCP en Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [MCP en Claude Code](https://code.claude.com/docs/en/mcp), [MCP en Cursor Agent y CLI](https://prod.cursor.com/docs/cli/mcp).

Claude Code carga `.mcp.json` desde este proyecto; Cursor usa `.cursor/mcp.json`. Para usarlo desde otro proyecto, añade la entrada `ui-auditor` generada por `setup` a la configuración de ese proyecto, conservando sus otros servidores. Las rutas absolutas apuntan al clon donde instalaste las dependencias. Los agentes remotos necesitan su propia instalación del servidor y acceso a la aplicación que se evalúa.

Después de recargar los MCP, confirma que aparecen `audit_start`, `audit_capture` y `browser_navigate`. `npm start` inicia el transporte stdio; no abre un sitio ni un puerto HTTP.

## Solicitar una evaluación

Puedes usar el prompt MCP `audit_application`, o pedirle al agente:

> Usa ui-auditor para evaluar http://localhost:3000. Comprueba el inicio de sesión, la búsqueda y la creación de un registro con datos de prueba. Revisa escritorio, tablet y móvil; usabilidad, accesibilidad, diseño visual, navegación, funcionamiento, estados y errores, rendimiento, adaptación, compatibilidad y experiencia. Interactúa realmente con la página, captura los problemas y genera un reporte HTML con mejoras priorizadas. Indica qué no pudiste comprobar y distingue hechos de hipótesis.

El servidor devuelve instrucciones al agente y proporciona un checklist para diez aspectos. Conviene definir las tareas, roles y rutas que importan: una visita a la página de inicio no demuestra que se haya revisado toda la aplicación.

## Flujo y herramientas propias

1. `audit_start`: define URL, tareas y alcance; devuelve `audit_id`.
2. `browser_*`: el agente navega y realiza las tareas mediante Playwright MCP.
3. `audit_capture`: guarda el viewport seleccionado, devuelve la imagen y `evidence_id`, ejecuta axe y recoge tiempos de navegación. Se puede omitir axe con `run_axe: false`.
4. `audit_finding`: registra categoría, prioridad, observación, impacto, propuesta, pasos, evidencia y confianza. `region: {x, y, width, height}` marca un área de la captura en píxeles del viewport.
5. `audit_lighthouse`: mide una URL pública en móvil o escritorio, preserva los informes originales y devuelve una evidencia de rendimiento.
6. `audit_assess`: marca un aspecto como revisado, parcial o no aplicable, con explicación y evidencia. Los aspectos sin evaluación quedan pendientes.
7. `audit_report`: genera el HTML con imágenes incorporadas, filtros por prioridad, cobertura y recomendaciones. Puede imprimirse o guardarse como PDF desde el navegador.

`audit_status` recupera la auditoría guardada usando su ID, incluso después de reiniciar el servidor. Cada hallazgo necesita una captura de esa auditoría; no se aceptan evidencias de otra auditoría ni regiones fuera de la imagen.

Los hallazgos automáticos de axe identifican reglas y selectores; el agente debe inspeccionar esos elementos y capturar su ubicación si quedan fuera del viewport. Los casos `incomplete` se conservan para revisión manual. Detectar desbordamiento horizontal produce una hipótesis, porque puede ser intencional en una tabla.

## Reportes y sesiones

Se guardan en `reports/<audit_id>/`:

- `audit.json`: capturas, evaluaciones, hallazgos, resumen y resultados Lighthouse.
- `<evidence_id>.png`: captura del estado explorado.
- `<evidence_id>.json`: datos técnicos del estado capturado.
- `report.html`: reporte principal con las imágenes incorporadas; puedes compartir ese archivo sin las PNG.
- `<evidence_id>-lighthouse.html` y `.json`: informes completos de Lighthouse. Comparte la carpeta si necesitas conservar los enlaces a los informes originales.

El navegador de exploración es visible por defecto. Puedes iniciar sesión manualmente en él o usar una cuenta de pruebas mediante el agente; la sesión se comparte entre las herramientas de navegación y axe. Al cerrar el servidor se cierra el navegador y se descarta la sesión. Los reportes permanecen.

Lighthouse **abre otro navegador, sin las cookies de la sesión explorada**, y navega de nuevo a la URL indicada. Si la aplicación redirige al inicio de sesión, estarás midiendo esa página: comprueba la URL final y su captura. Su resultado no representa un modal abierto ni un estado autenticado de la SPA. Para estos estados, registra la limitación en la cobertura.

`mask_selectors: ["#email", "[data-sensitive]"]` oculta elementos en la captura. No redacta selectores, URL, datos técnicos ni capturas Lighthouse; usa datos de prueba cuando el reporte se vaya a compartir.

Variables opcionales del servidor:

- `UI_AUDITOR_HEADLESS=1`: navegador sin ventana para CI y pruebas.
- `UI_AUDITOR_REPORTS`: directorio absoluto de reportes.
- `UI_AUDITOR_BROWSER`: `chrome` (predeterminado), `msedge`, `firefox` o `webkit`. Para los dos últimos instala el navegador de Playwright con `npx playwright install firefox` o `npx playwright install webkit`.

## Comprobación y demostración

```powershell
npm test
npm run demo
npm run demo -- --lighthouse
```

La prueba ejecuta un cliente MCP real contra una aplicación local con defectos intencionales: interactúa con el formulario, verifica axe y desbordamiento móvil, guarda imágenes, rechaza evidencia inexistente y comprueba el escape de HTML en el reporte. La demo imprime la ruta de un reporte real de esa aplicación de prueba; no evalúa una aplicación del usuario.

El workflow de GitHub Actions instala Node.js y Chrome en Ubuntu, ejecuta la prueba MCP y genera un reporte de demostración con Lighthouse. Se activa en pushes, pull requests y ejecuciones manuales.

## Qué requiere juicio humano

El checklist permite cubrir todos los aspectos de la interfaz, pero la cobertura depende de las tareas realmente exploradas. Un resultado automático no certifica accesibilidad; un único navegador no demuestra compatibilidad; la revisión de un agente no mide satisfacción de usuarios reales. Estas limitaciones deben quedar visibles como parciales o pendientes, con propuestas concretas de validación. Las pruebas de seguridad, carga y lógica interna requieren evaluaciones específicas fuera de esta herramienta de interfaz.

## Publicar en GitHub

Con el código guardado en Git y GitHub CLI autenticado, puedes crear el repositorio y subirlo:

```sh
gh repo create ui-auditor --public --source=. --remote=origin --push
```

También puedes crear un repositorio vacío desde GitHub, añadir su URL como `origin` y subir la rama `main`. Los reportes, dependencias, configuraciones MCP locales, variables de entorno y cachés de Graft quedan excluidos de Git. El repositorio contiene una captura de la aplicación de prueba para ilustrar el resultado.

## Licencia

El código de UI Auditor se distribuye bajo la [licencia MIT](LICENSE). Las dependencias conservan sus propias licencias.
