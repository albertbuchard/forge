

<p align="center">
  <img src="https://raw.githubusercontent.com/albertbuchard/forge/main/plugins/openclaw/docs/assets/brand-icons/forge-logo-imagegen2-transparent-1280.png" alt="Forge" width="720" />
</p>

[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=06121c)](https://react.dev/)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Fastify 5](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-ffc131?logo=tauri&logoColor=1f2937)](https://tauri.app/)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-6ba539?logo=openapiinitiative&logoColor=white)](https://www.openapis.org/)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-8ab4ff)](https://albertbuchard.github.io/forge/)

# Forge

Forge es una aplicación, API y entorno de ejecución para agentes con enfoque en lo local para la memoria estructurada.

Almacena las partes del trabajo y la vida que necesitan seguir siendo utilizables con el tiempo: objetivos, proyectos, tareas, notas, páginas de wiki, registros de Psyche, preferencias, planes de calendario, sueño, entrenamientos, movimiento, alimentación, Eventos de Vida, archivos confiables y trabajo de agentes. Los mismos registros están disponibles en la aplicación web, a través de la API y mediante integraciones de agentes confiables.

La memoria no estructurada conserva conversaciones, notas, prosa de wiki, transcripciones y rastros de razonamiento. Forge lo complementa guardando elementos seleccionados como registros que puedes buscar, enlazar, revisar, programar, actualizar, incrustar, restaurar y devolver a agentes confiables.

Lee la documentación completa publicada en la [documentación de Forge en GitHub Pages](https://albertbuchard.github.io/forge/).

## Tabla de Contenidos

- [Por qué Forge](#why-forge)
- [Cómo lo resuelve Forge](#how-forge-solves-it)
- [Instalar Forge](#install-forge)
- [Ejecutar la aplicación de origen localmente](#run-the-source-app-locally)
- [Configuración avanzada de adaptadores](#advanced-adapter-setup)
- [Ubicación de datos y copias de seguridad](#data-location-and-backups)
- [Qué cubre Forge](#what-forge-covers)
- [Capturas de pantalla](#screenshots)
- [Documentación](#documentation)
- [Verificaciones para contribuyentes](#contributor-checks)
- [Licencia](#license)

## Por qué Forge

Forge brinda a humanos y agentes de IA el mismo sistema local de registro.

Un usuario puede conversar sobre algo en un chat, nota, página de wiki o transcripción, y luego guardar en Forge la parte que requiere seguimiento. Forge puede mantener un objetivo, tarea, creencia, informe de desencadenante, preferencia, archivo, bloque de calendario, noche de sueño, entrenamiento, patrón de movimiento o acción de agente conectado a los otros registros a su alrededor.

En uso práctico, Forge te permite guardar una creencia de una conversación, conectar un archivo a un proyecto, adjuntar una nota a un entrenamiento, convertir una decisión en una tarea, revisar un patrón de desencadenante, consultar el historial de preferencias o permitir que un agente lea el mismo contexto antes de actuar.

Un proyecto puede apuntar a su página de wiki, archivos, tareas, decisiones, bloques de calendario, contexto de recuperación y ejecuciones de agentes. Un patrón de Psyche puede apuntar a informes de desencadenantes, creencias, notas y tarjetas de apoyo. Un archivo confiable puede apuntar al objetivo, tarea, página de wiki, nota o registro de Psyche que respalda.

## Cómo lo resuelve Forge

Forge se ejecuta localmente. La aplicación del navegador, la API, OpenClaw, Hermes, Codex, Claude Code, la aplicación complementaria para iPhone y la superficie de comandos de watchOS pueden utilizar los mismos registros de Forge cuando se configuran juntos.

En Forge, puedes:

- planificar el trabajo a través de objetivos, estrategias, proyectos, incidencias (issues), tareas, subtareas, hábitos, ejecuciones de tareas, ajustes de trabajo, informes de finalización y referencias git enlazadas
- mantener notas y páginas de wiki con enlaces inversos (backlinks), búsqueda, trabajos de ingestión y enlaces a los registros que explican
- almacenar material de Psyche como valores, creencias, modos, patrones de comportamiento, comportamientos, informes de desencadenantes, definiciones de emociones, tipos de eventos, tarjetas de memoria, ejecuciones de cuestionarios y notas de autoobservación
- rastrear preferencias a través de catálogos, elementos, juicios, señales, contextos, comparaciones y actualizaciones de puntuación
- trabajar con eventos de calendario, plantillas de bloques de trabajo, límites de tiempo para tareas, conexiones de proveedores, estado de sincronización y proyecciones de calendario editables
- revisar sueño, entrenamientos, importaciones de HealthKit, carga de entrenamiento, nutrición, contexto de pérdida de peso, líneas de tiempo de movimiento, lugares, viajes, Fuerza Vital y señales de fatiga
- almacenar hojas de cálculo confiables, documentos, PDFs, texto, texto estructurado, imágenes y otros archivos compatibles en el Almacén de Artefactos con procedencia, escaneos, puntuaciones de riesgo, versiones, eventos de auditoría, enlaces y descargas para humanos
- coordinar usuarios humanos, usuarios bot, sesiones de ejecución de agentes, propietarios, asignados, aprobaciones y acciones de agentes auditadas
- anclar registros importantes de Forge y reanudar registros verdaderamente vistos recientemente desde la Barra de Acciones, la aplicación complementaria para iPhone, la Bandeja de entrada del reloj y las rutas de lectura de agentes confiables

La jerarquía de trabajo es explícita:

```text
Goal -> Strategy -> Project -> Strategy -> Issue -> Task -> Subtask
```

Los proyectos son iniciativas respaldadas por PRDs. Las incidencias (issues) son cortes verticales a través de la pila. Las tareas representan una sesión de IA enfocada cada una. Las subtareas son pequeños pasos hijos. Los informes de finalización pueden registrar los archivos modificados, resumir el trabajo y enlazar las referencias git relevantes.

Psyche es una superficie central de Forge. Una conversación puede revelar una creencia, desencadenante, modo, valor o patrón de comportamiento; Forge puede guardarlo como un registro conectado a notas, tarjetas, episodios y revisiones futuras.

Los artefactos también son una superficie central de Forge. Un archivo confiable puede convertirse en un registro del Almacén de Artefactos conectado a los registros de Forge que respalda. El acceso de los agentes se mantiene limitado a cargas confiables, metadatos, escaneos, enriquecimiento, enlaces, versiones e historial de auditoría. Los usuarios humanos obtienen la ruta de descarga.

La salud, el movimiento y la recuperación son parte del mismo grafo de memoria. Las noches de sueño, los entrenamientos, la carga de entrenamiento, el contexto de nutrición, los lugares, los viajes, la Fuerza Vital, las señales de fatiga y las líneas de tiempo de movimiento pueden coexistir junto a las decisiones, tareas, notas y registros de Psyche que ayudan a explicar.

Los mismos registros son utilizados por la aplicación web de React, la API de Fastify, OpenClaw, Hermes, Codex, Claude Code, la aplicación complementaria para iPhone y la superficie de comandos de watchOS. La base de datos permanece local de forma predeterminada, con controles explícitos de carpeta de datos y copias de seguridad en `Settings -> Data`.

Forge está construido con React 19, TypeScript 5.x, Vite 6, Tailwind CSS 4, Fastify 5, SQLite, OpenAPI generado, Tauri 2, OpenClaw, Hermes, Codex MCP, Claude Code MCP, un transporte complementario Iroh en Rust y una aplicación complementaria para iPhone en Swift que enlaza nativamente el mismo núcleo de transporte Rust.

## Instalar Forge

### Instalación con un solo comando

La instalación preferida para todos es un solo comando guiado:

```bash
npx forge-memory
```

Necesitas Node.js 22 o una versión más reciente. Para el recorrido numerado completo, que incluye cada elección del instalador, verificación de éxito, diferencia de plataforma, aprobación de navegador remoto y prompt para iPhone, lee [Instalar Forge](./docs/installation.md).

`forge-memory` es la puerta de entrada de Forge. Instala la UI/entorno de ejecución local de Forge, descubre OpenClaw, Hermes, Codex y Claude Code en segundo plano, muestra los adaptadores de host detectados en un menú de casillas, selecciona todos los adaptadores detectados de forma predeterminada, deja los adaptadores faltantes visibles como filas deshabilitadas con `not found`, permite usar la barra espaciadora para alternar las elecciones de adaptadores y puede emparejar la aplicación complementaria de iOS al final.

Usa el mismo comando ya sea que quieras la UI del navegador, OpenClaw, Hermes, Codex, Claude Code, o todos ellos compartiendo un sistema de memoria local de Forge.

La primera ejecución exacta es:

1. Ejecuta `npx forge-memory` como tu usuario normal del sistema operativo.
2. Conserva o cambia los adaptadores detectados.
3. Confirma la carpeta de datos de Forge, normalmente `~/.forge`.
4. Deja desactivado el intercambio opcional de Forge a Forge a menos que lo necesites.
5. Empareja el iPhone ahora o omítelo y ejecuta `npx forge-memory pair-ios` más tarde.
6. Espera `Forge Memory configured and checked.` y `Doctor: passed`.
7. Ejecuta `npx forge-memory ui`, luego verifica con `npx forge-memory status` y `npx forge-memory doctor`.

Forge Companion ya debe estar instalado antes del emparejamiento del iPhone. Actualmente se distribuye a probadores invitados a través de TestFlight; `forge-memory` crea el material de emparejamiento pero no instala la aplicación ni registra una cuenta de TestFlight. Omite el prompt del teléfono si aún no tienes Companion.

El instalador prepara un asistente de autenticación local por usuario. Los adaptadores locales usan ese asistente automáticamente, por lo que no necesitas copiar ni mantener una clave API. Abre el navegador con `npx forge-memory ui`. En macOS, Forge registra un controlador local solo para el propietario y usa una transacción pública corta vinculada a una clave efímera mantenida por ese navegador. No se coloca ninguna credencial de sesión en la URL, argumentos de comando o almacenamiento del navegador. Forge mantiene la sesión local renovable resultante en una cookie HttpOnly. El valor CSRF separado y no de autenticación permanece en el almacenamiento del navegador del mismo origen para el mismo perfil de navegador, por lo que las nuevas pestañas pueden seguir escribiendo sin otro prompt. Un navegador que bloquea los lanzamientos automáticos de protocolos externos recibe un enlace preconfigurado **Authorize this browser** para que la verificación de propietario comience directamente desde ese clic explícito.

El acceso a la red no autoriza Forge. Un navegador o cliente API que alcance Forge a través de Tailscale o otra red aún necesita una credencial con alcance emitida por Forge. Tailscale Serve puede proporcionar transporte HTTPS privado, pero es un filtro de red adicional y no un sustituto de la autenticación de Forge. Tailscale Funnel no es necesario.

El emparejamiento remoto otorga alcances normales de interfaz de usuario y API sin prompts repetidos. Forge rechaza los alcances `machine.*` a menos que esa instalación tenga un trabajador aislado del sistema operativo disponible y validado; nunca vuelve a ejecutar trabajo de máquina remota como el proceso del servidor Forge.

Las instalaciones de desarrollo usan el mismo flujo, pero vinculan los adaptadores a esta extracción de código fuente y usan como predeterminada la carpeta de datos compartida real de Forge:

```bash
npx forge-memory --dev
```

Después de la instalación, vuelve a abrir el flujo de configuración completa con la configuración actual como predeterminada:

```bash
npx forge-memory configure
```

Comandos de ejecución útiles:

```bash
npx forge-memory status
npx forge-memory doctor
npx forge-memory doctor --repair
npx forge-memory update
npx forge-memory ui
npx forge-memory restart
npx forge-memory stop
npx forge-memory export
npx forge-memory uninstall
npx forge-memory pair-ios
```

`doctor --repair` verifica la instalación local, recrea las carpetas locales faltantes, inicia o reinicia el entorno de ejecución cuando se permite, e imprime los siguientes pasos concretos sin eliminar los datos de Forge.

`pair-ios` prefiere Tailscale cuando está instalado, autenticado y Forge es accesible a través de la URL HTTPS de MagicDNS del host. Esto le da al iPhone una URL de Forge normal accesible por teléfono para sincronización y el WebView integrado. Si Tailscale no está disponible o se declina, Forge vuelve a un código QR Iroh con el id de nodo Iroh de escritorio, token de emparejamiento, pista de retransmisión opcional y ALPN `forge-companion/1`. La CLI usa un QR compacto y guarda la misma carga útil compacta en `~/.forge/pairing/` para que puedas pegarla en la aplicación del iPhone si la cámara no puede escanear.

El emparejamiento del teléfono puede preguntar antes de instalar Tailscale, configurar Tailscale Serve, instalar la cadena de herramientas Rust/Cargo mínima para la alternativa Iroh, compilar el host nativo incluido o reiniciar solo el entorno de ejecución administrado de Forge para vincular su origen HTTPS verificado. Cada cambio condicional se muestra antes de ocurrir. Omite el emparejamiento del teléfono si no quieres esos pasos durante la instalación base.

El emparejamiento directo HTTP/TCP explícito permanece disponible para configuraciones deliberadas de LAN, Tailscale o depuración. Un iPhone físico necesita una URL accesible por teléfono:

```bash
npx forge-memory pair-ios --public-url https://your-mac.tailnet.ts.net/forge/
```

Las URLs de bucle local como `127.0.0.1` son útiles para el Simulador de iOS, pero se rechazan para el emparejamiento de teléfono físico.

La ruta de instalación corta es intencionalmente toda la configuración base. Si quieres los detalles de red de nivel inferior, lee la referencia del transporte complementario en [`docs/reference/companion-iroh.md`](./docs/reference/companion-iroh.md) o la guía publicada de [Companion Transport](https://albertbuchard.github.io/forge/companion-transport.html).

`export` crea una copia de seguridad portátil de la carpeta de datos real de Forge. `uninstall` elimina el administrador y la caché del entorno de ejecución de Forge Memory, pero conserva la carpeta de datos de Forge de forma predeterminada; usa `--remove-data` solo cuando quieras eliminar explícitamente los datos también. `update` hace una copia de seguridad de la carpeta de datos de Forge cuando corresponda, actualiza el entorno de ejecución y los adaptadores seleccionados, preserva los datos del usuario e informa la ubicación de la copia de seguridad antes de realizar cambios.

Después de la instalación, las direcciones locales habituales son:

- Aplicación web: `http://127.0.0.1:4317/forge/`
- API: `http://127.0.0.1:4317/api/v1/`
- OpenAPI: `http://127.0.0.1:4317/api/v1/openapi.json`

La configuración manual de OpenClaw, Hermes, Codex y Claude Code sigue existiendo para casos avanzados en [`docs/reference/openclaw-plugin.md`](./docs/reference/openclaw-plugin.md),
[`docs/reference/hermes-plugin.md`](./docs/reference/hermes-plugin.md),
[`plugins/codex/README.md`](./plugins/codex/README.md) y
[`docs/reference/claude-code-adapter.md`](./docs/reference/claude-code-adapter.md).

## Ejecutar la aplicación de origen localmente

Usa esto cuando estés desarrollando Forge mismo.

```bash
npm install
npm run dev
```

Abre Forge a través de la URL del backend:

```text
http://127.0.0.1:4317/forge/
```

Vite también puede ejecutarse en `3027` durante el desarrollo, pero el punto de entrada estable de la aplicación sigue ser el montaje del backend en `4317`. Abrir el puerto de Vite directamente no omite la autenticación de Forge.

## Configuración avanzada de adaptadores

El flujo guiado de `npx forge-memory` es la ruta normal. Usa estos comandos solo para depuración específica de adaptadores, vinculación local de código fuente o recuperación.

### Plugin de OpenClaw durante el desarrollo

Desde la raíz del repositorio de Forge:

```bash
openclaw plugins install --link --dangerously-force-unsafe-install ./plugins/openclaw
openclaw plugins enable forge-openclaw-plugin
openclaw gateway restart
openclaw plugins inspect forge-openclaw-plugin --runtime
openclaw forge health
```

Usa `--link` cuando quieras que OpenClaw use esta extracción directamente. Omite `--link` cuando quieras probar una instalación de paquete copiada.

### Comandos del adaptador de Hermes

Usa el paquete PyPI publicado cuando quieras que Hermes cargue el plugin lanzado:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade pip
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade forge-hermes-plugin
```

Usa esto desde el repositorio de Forge en su lugar cuando quieras que Hermes siga ediciones locales de código fuente:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade pip
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable ./plugins/hermes
```

### Comandos de Codex MCP

Prefiere `npx forge-memory`, que escribe la entrada MCP de Forge a través de su flujo de configuración guiado. Codex usa el puente MCP de Forge desde este repositorio:

```bash
codex mcp add forge \
  --env FORGE_ORIGIN=http://127.0.0.1 \
  --env FORGE_PORT=4317 \
  --env FORGE_ACTOR_LABEL=codex \
  --env FORGE_TIMEOUT_MS=15000 \
  -- /bin/zsh /absolute/path/to/forge/plugins/codex/scripts/run-mcp.sh
codex mcp list
```

## Ubicación de datos y copias de seguridad

De forma predeterminada, las instalaciones locales de plugins almacenan los datos de Forge en `~/.forge`. Puedes elegir otra carpeta configurando `dataRoot` en la configuración del plugin o usando `Settings -> Data` en la aplicación web.

Si OpenClaw, Hermes, Codex, Claude Code y el navegador deben compartir un sistema Forge, apúntalos al mismo origen, puerto y raíz de datos. Antes de mover o fusionar carpetas de datos, haz una copia de seguridad de cada `forge.sqlite` candidato y verifica qué base de datos ha abierto el entorno de ejecución en vivo.

## Qué cubre Forge

- Psyche y reflexión: valores, creencias, modos, patrones de comportamiento, comportamientos, informes de desencadenantes, definiciones de emociones, tipos de eventos, tarjetas de memoria, ejecuciones de cuestionarios y autoobservación
- memoria de conocimiento: notas, páginas de wiki, búsqueda, ingestión, enlaces inversos, evidencia y contexto de Forge enlazado
- artefactos: hojas de cálculo confiables, documentos, PDFs, texto estructurado, texto e imágenes con metadatos, procedencia, escaneos, versiones, enlaces de entidades genéricas y descargas solo para humanos
- contexto de salud y cuerpo: noches de sueño, entrenamientos, carga de entrenamiento, historial de movimiento, contexto de nutrición y pérdida de peso, importaciones de HealthKit y sincronización con iPhone
- preferencias: catálogos, contextos, elementos de preferencia, juicios, señales, comparaciones y actualizaciones de puntuación
- calendario y tiempo: eventos nativos, Eventos de Vida, calendarios espejo, conexiones de proveedores, plantillas de bloques de trabajo y límites de tiempo para tareas
- planificación y ejecución: objetivos, estrategias, proyectos, incidencias, tareas, subtareas, ejecuciones de tareas, hábitos, ajustes de trabajo e informes de finalización enlazados a git
- agentes y colaboración: OpenClaw, Hermes, Codex, Claude Code, usuarios humanos y bot explícitos, filtros de propietario/asignado, sesiones de ejecución, aprobaciones y acciones auditadas
- progreso: XP, niveles, rachas, trofeos, packs de arte descargables opcionales e historial de recompensas local

## Capturas de pantalla

| Superficie           | Captura de pantalla                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Vista general        | ![Panel general de Forge](./plugins/openclaw/docs/assets/forge-overview-dashboard.png)   |
| Proyectos            | ![Tablero de proyectos de Forge](./plugins/openclaw/docs/assets/forge-projects-board.png)|
| Tablero de ejecución | ![Tablero Kanban de Forge](./plugins/openclaw/docs/assets/forge-kanban-board.png)        |
| Conocimiento y memoria| ![Memoria de wiki de Forge](./plugins/openclaw/docs/assets/forge-wiki-memory.png)        |
| Sueño y salud        | ![Vista general de sueño de Forge](./plugins/openclaw/docs/assets/forge-sleep-overview.png)|

## Documentación

Comienza con [`docs/README.md`](./docs/README.md). Las referencias de configuración y arquitectura duraderas se encuentran en [`docs/reference/`](./docs/reference/), y los procedimientos de lanzamiento en [`docs/release/`](./docs/release/). Los objetivos privados, informes de automatización, traspasos de auditoría y notas de planificación derivadas de conversaciones no pertenecen a este repositorio público.

Los nuevos contribuyentes también deben leer la referencia [`Estructura del Repositorio`](./docs/reference/repository-structure.md) antes de mover archivos o cambiar límites de lanzamiento/paquete.

- Inicio de la documentación: [albertbuchard.github.io/forge](https://albertbuchard.github.io/forge/)
- Características: [albertbuchard.github.io/forge/features.html](https://albertbuchard.github.io/forge/features.html)
- Integraciones: [albertbuchard.github.io/forge/integrations.html](https://albertbuchard.github.io/forge/integrations.html)
- Transporte complementario: [albertbuchard.github.io/forge/companion-transport.html](https://albertbuchard.github.io/forge/companion-transport.html)
- Referencia de API: [albertbuchard.github.io/forge/api/](https://albertbuchard.github.io/forge/api/)
- Docs del repositorio: [`docs/`](./docs)

## Verificaciones para contribuyentes

```bash
npx tsc --noEmit
npm run test
npm run test:server
```

Los detalles de contribuyentes y entorno de ejecución se encuentran en la [Guía de desarrollo](https://albertbuchard.github.io/forge/development.html) y la [Referencia de ingeniería](https://albertbuchard.github.io/forge/engineering.html). El paquete publicable de OpenClaw se encuentra en [`plugins/openclaw/`](./plugins/openclaw), el adaptador de Hermes en [`plugins/hermes/`](./plugins/hermes), y los adaptadores MCP de Codex y Claude Code usan el punto de entrada MCP compartido de Forge Memory.

## Licencia

El código público propiedad de Forge está licenciado bajo Apache-2.0. La licencia es permisiva, amigable para uso comercial e incluye una cesión explícita de patentes, lo que mantiene una vía limpia para futuros forks comerciales de código cerrado de Forge.
