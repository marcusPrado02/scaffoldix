# Scaffoldix — Guía Completa de Usuario

> Una CLI profesional de scaffolding de código construida sobre packs deterministas, diseñada para DevX e Ingeniería de Plataformas.

---

## Tabla de Contenidos

1. [¿Qué es Scaffoldix?](#qué-es-scaffoldix)
2. [Instalación](#instalación)
3. [Conceptos Fundamentales](#conceptos-fundamentales)
4. [Guía de Uso Diario](#guía-de-uso-diario)
5. [Referencia de Comandos](#referencia-de-comandos)
6. [Flags Globales](#flags-globales)
7. [Variables y Transformaciones](#variables-y-transformaciones)
8. [Parcheo de Archivos Existentes](#parcheo-de-archivos-existentes)
9. [Hooks y Comprobaciones de Calidad](#hooks-y-comprobaciones-de-calidad)
10. [Crear tu Propio Pack](#crear-tu-propio-pack)
11. [Uso Avanzado](#uso-avanzado)
12. [Solución de Problemas](#solución-de-problemas)

---

## ¿Qué es Scaffoldix?

Scaffoldix es una CLI que automatiza tareas repetitivas de generación de código usando **packs**. Un pack es una colección reutilizable de plantillas y reglas que sabe cómo generar código para un propósito específico — como crear un servicio REST, un componente React, una entidad de base de datos, o un proyecto completo desde cero.

**Qué diferencia a Scaffoldix de las herramientas `create-*`:**

- **Los packs son versionados e instalables** desde rutas locales, repositorios GitHub, o paquetes npm
- **Genera dentro de proyectos existentes** — no solo proyectos nuevos
- **Parchea archivos existentes** de forma inteligente (imports, exports, archivos de configuración) usando operaciones idempotentes
- **Ejecuta controles de calidad** (build, test, lint) tras la generación y revierte los cambios si alguno falla
- **Registra cada generación** con un historial completo y un rollback con un solo comando
- **Modo dry-run** que muestra exactamente qué cambiará antes de tocar ningún archivo

---

## Instalación

```bash
# Instalar globalmente con npm
npm install -g scaffoldix

# O con pnpm
pnpm add -g scaffoldix

# Verificar la instalación
scaffoldix --version
scaffoldix doctor
```

### Autocompletado de Shell (opcional pero recomendado)

```bash
# Bash
scaffoldix completion bash >> ~/.bashrc && source ~/.bashrc

# Zsh
scaffoldix completion zsh >> ~/.zshrc && source ~/.zshrc

# Fish
scaffoldix completion fish > ~/.config/fish/completions/scaffoldix.fish
```

---

## Conceptos Fundamentales

### Pack

Un **pack** es un directorio que contiene un manifiesto `archetype.yaml` y una carpeta `templates/`. Define uno o más arquetipos, cada uno con sus propias plantillas, inputs, parches, hooks y comprobaciones.

```
mi-pack/
├── archetype.yaml        # Manifiesto del pack
└── templates/
    └── service/
        └── __entityName__.service.ts  # Archivo de plantilla
```

### Arquetipo (Archetype)

Un **arquetipo** es una receta de scaffolding específica dentro de un pack. Un pack para un backend Java podría tener arquetipos como `rest-service`, `repository`, `dto`, etc. Para generar desde un arquetipo específico se usa la notación `packId:archetypeId`.

### Plantilla (Template)

Las plantillas son archivos procesados por el motor [Handlebars](https://handlebarsjs.com/). Las variables se inyectan como `{{nombreVariable}}`. Los marcadores de nombre de archivo usan la sintaxis `__nombreVariable__`.

### Parche (Patch)

Un **parche** modifica un archivo que ya existe en tu proyecto (por ejemplo, agrega un import a `index.ts`, fusiona claves en `package.json`). Los parches son idempotentes — ejecutar la misma generación dos veces no duplicará contenido.

### Registro de Packs

Cuando instalas un pack, Scaffoldix lo registra en `~/.scaffoldix/registry.json`. Todos los packs instalados están disponibles en todos tus proyectos en esa máquina.

### Estado del Proyecto

Cada proyecto que usa Scaffoldix tiene un archivo `.scaffoldix/state.json` que registra cada generación — qué se creó, qué se parcheó, qué comprobaciones se ejecutaron.

---

## Guía de Uso Diario

Esta sección cubre los patrones más comunes del día a día.

### Día 1: Instalar un Pack y Generar tu Primer Archivo

```bash
# 1. Instalar un pack desde un directorio local
scaffoldix pack add ./mi-company-pack

# 2. Ver qué arquetipos ofrece el pack
scaffoldix pack info mi-company-pack

# 3. Previsualizar lo que generaría (seguro — no escribe nada)
scaffoldix generate mi-company-pack:service --dry-run

# 4. Generar de verdad
scaffoldix generate mi-company-pack:service
```

Te pedirá los inputs que el arquetipo requiera (por ejemplo, nombre del servicio, módulo destino, etc.).

### Agregar un Pack desde GitHub

```bash
# Repositorio público (usa la rama por defecto)
scaffoldix pack add github:mi-org/scaffoldix-packs

# Tag o rama específica
scaffoldix pack add github:mi-org/scaffoldix-packs --ref v2.0.0
scaffoldix pack add github:mi-org/scaffoldix-packs --ref main
```

### Agregar un Pack desde npm

```bash
# Última versión
scaffoldix pack add npm:@mi-empresa/scaffoldix-pack

# Versión específica
scaffoldix pack add npm:@mi-empresa/scaffoldix-pack --ref 1.4.0
```

### Generar en Modo No Interactivo

Al ejecutar en CI o en scripts, pasa todos los inputs como flags para omitir las preguntas:

```bash
scaffoldix generate mi-pack:service \
  --yes \
  --target ./src/services \
  -- serviceName=OrderService module=orders useAuth=true
```

> Los inputs se pasan después de `--` como pares `clave=valor`.

### Revisar Cambios Antes de Confirmar

Siempre usa `--dry-run` antes de una generación real para revisarla:

```bash
scaffoldix generate mi-pack:entity --dry-run
```

Ejemplo de salida:

```
  CREATE  src/entities/Order.entity.ts
  CREATE  src/entities/Order.dto.ts
  MODIFY  src/entities/index.ts       (parche: export-entity-order)
  NOOP    src/app.module.ts           (parche ya aplicado)
```

### Deshacer una Generación

```bash
# Ver qué eliminaría el rollback
scaffoldix rollback --dry-run

# Ejecutar el rollback
scaffoldix rollback

# Confirmar sin prompt
scaffoldix rollback --yes
```

> El rollback elimina los archivos que fueron **creados** por la última generación. Los archivos parcheados deben revertirse manualmente (por ejemplo, con `git checkout`).

### Actualizar un Pack

```bash
# Actualizar a la última versión
scaffoldix pack update mi-company-pack

# Actualizar a una versión específica
scaffoldix pack update mi-company-pack --ref v2.1.0
```

### Ver el Historial de Generaciones

```bash
# Legible por humanos
scaffoldix history

# Con más entradas
scaffoldix history --limit 50

# JSON para scripts o editores
scaffoldix history --json
```

### Ejecutar el Diagnóstico

Si algo parece raro, ejecuta el diagnóstico:

```bash
scaffoldix doctor
```

Verifica: versión de Node.js, disponibilidad de Git, directorio de configuración de Scaffoldix, salud del registro, y más.

---

## Referencia de Comandos

### `scaffoldix generate <packId:archetypeId>`

Genera código desde un arquetipo instalado.

```bash
scaffoldix generate mi-pack:service
scaffoldix generate mi-pack:service --target ./src/modules/auth
scaffoldix generate mi-pack:service --dry-run
scaffoldix generate mi-pack:service --force         # sobreescribir archivos existentes
scaffoldix generate mi-pack:service --skip-checks   # omitir controles de calidad
scaffoldix generate mi-pack:service --skip-patches  # solo plantillas
scaffoldix generate mi-pack:service --yes           # sin preguntas, usar valores por defecto
```

| Flag             | Por defecto | Descripción                             |
| ---------------- | ----------- | --------------------------------------- |
| `--target <dir>` | `.`         | Directorio de salida                    |
| `--dry-run`      | false       | Previsualizar sin escribir              |
| `--force`        | false       | Sobreescribir archivos existentes       |
| `--yes`          | false       | Usar valores por defecto, sin preguntas |
| `--skip-patches` | false       | Omitir operaciones de parche            |
| `--skip-checks`  | false       | Omitir comandos de control de calidad   |

### `scaffoldix pack add <origen>`

Instalar un pack desde una ruta local, URL de GitHub, o paquete npm.

```bash
scaffoldix pack add ./ruta/al/pack           # local
scaffoldix pack add github:org/repo          # GitHub (rama por defecto)
scaffoldix pack add github:org/repo --ref v1.0.0   # tag específico
scaffoldix pack add npm:@org/nombre-pack     # npm última versión
scaffoldix pack add npm:@org/nombre-pack --ref 2.0.0  # versión específica
```

### `scaffoldix pack list`

Listar todos los packs instalados.

```bash
scaffoldix pack list
scaffoldix pack list --json
```

### `scaffoldix pack info <packId>`

Mostrar detalles de un pack instalado, incluyendo todos sus arquetipos e inputs.

```bash
scaffoldix pack info mi-pack
scaffoldix pack info mi-pack --json
```

### `scaffoldix pack remove <packId>`

Desinstalar un pack. No afecta los archivos ya generados.

```bash
scaffoldix pack remove mi-pack
```

### `scaffoldix pack update <packId>`

Obtener la última versión (o una ref específica) de un pack.

```bash
scaffoldix pack update mi-pack
scaffoldix pack update mi-pack --ref v2.0.0
```

### `scaffoldix pack validate <ruta>`

Validar un pack antes de publicarlo o usarlo. Verifica sintaxis YAML, cumplimiento del schema, y corrección de plantillas.

```bash
scaffoldix pack validate ./mi-pack
scaffoldix pack validate ./mi-pack --strict
```

### `scaffoldix pack verify <packId>`

Verificar la integridad del pack instalado usando hashing SHA-256.

```bash
scaffoldix pack verify mi-pack
```

### `scaffoldix pack search <keyword>`

Buscar en el registro público de packs.

```bash
scaffoldix pack search react
scaffoldix pack search java spring --json
```

### `scaffoldix pack publish`

Publicar tu pack en npm. Ejecuta validación primero.

```bash
scaffoldix pack publish              # desde el directorio actual
scaffoldix pack publish ./mi-pack   # desde una ruta específica
scaffoldix pack publish --dry-run   # ver qué se publicaría
```

### `scaffoldix archetypes`

Listar todos los arquetipos de todos los packs instalados.

```bash
scaffoldix archetypes
scaffoldix archetypes list --json
```

### `scaffoldix history`

Mostrar el historial de generaciones del proyecto actual.

```bash
scaffoldix history
scaffoldix history --limit 20
scaffoldix history --json
```

### `scaffoldix rollback`

Deshacer la última generación (elimina los archivos creados).

```bash
scaffoldix rollback
scaffoldix rollback --dry-run   # previsualizar qué se eliminaría
scaffoldix rollback --yes       # omitir la confirmación
```

### `scaffoldix init [directorio]`

Inicializar un nuevo pack de forma interactiva.

```bash
scaffoldix init              # en el directorio actual
scaffoldix init ./mi-pack    # en un nuevo directorio
```

### `scaffoldix doctor`

Ejecutar diagnóstico del sistema.

```bash
scaffoldix doctor
```

### `scaffoldix completion <shell>`

Imprimir el script de autocompletado.

```bash
scaffoldix completion bash
scaffoldix completion zsh
scaffoldix completion fish
```

---

## Flags Globales

| Flag        | Descripción                                       |
| ----------- | ------------------------------------------------- |
| `--verbose` | Mostrar salida adicional e información de tiempos |
| `--debug`   | Mostrar toda la salida incluyendo trazas internas |
| `--silent`  | Suprimir todo excepto los errores                 |
| `--json`    | Salida JSON legible por máquinas                  |
| `--help`    | Mostrar ayuda para un comando                     |
| `--version` | Imprimir número de versión                        |

---

## Variables y Transformaciones

### Interpolación Básica de Variables

En archivos de plantilla (`.ts`, `.yaml`, `.json`, etc.):

```handlebars
export class
{{serviceName}}Service { constructor(private readonly
{{repositoryName}}Repository:
{{repositoryName}}Repository) {} }
```

### Plantillas en Nombres de Archivo

Usa `__nombreVariable__` en los nombres de archivo:

```
templates/
└── __entityName__.entity.ts    →  order.entity.ts  (cuando entityName=order)
└── __entityName__.dto.ts       →  order.dto.ts
└── __EntityName__Controller.ts →  OrderController.ts
```

### Transformaciones Incorporadas

Dada la variable `entityName = "order item"`:

| Transformación | Resultado    | Uso en plantilla             |
| -------------- | ------------ | ---------------------------- |
| `camelCase`    | `orderItem`  | `{{entityName_camelCase}}`   |
| `PascalCase`   | `OrderItem`  | `{{entityName_PascalCase}}`  |
| `kebab-case`   | `order-item` | `{{entityName_kebabCase}}`   |
| `snake_case`   | `order_item` | `{{entityName_snakeCase}}`   |
| `UPPER_SNAKE`  | `ORDER_ITEM` | `{{entityName_UPPER_SNAKE}}` |
| `lower`        | `order item` | `{{entityName_lower}}`       |
| `upper`        | `ORDER ITEM` | `{{entityName_upper}}`       |
| `title`        | `Order Item` | `{{entityName_title}}`       |
| `dot.case`     | `order.item` | `{{entityName_dotCase}}`     |
| `path/case`    | `order/item` | `{{entityName_pathCase}}`    |

Las transformaciones se declaran por input en el manifiesto:

```yaml
inputs:
  - name: entityName
    type: string
    required: true
    transforms:
      - PascalCase
      - camelCase
      - kebab-case
      - snake_case
```

### Condicionales en Handlebars

```handlebars
{{#if useAuth}}
  import { AuthGuard } from '@nestjs/passport';
{{/if}}

{{#unless isPublic}}
  @UseGuards(AuthGuard)
{{/unless}}
```

---

## Parcheo de Archivos Existentes

Los parches modifican archivos que ya existen en tu proyecto. Son **idempotentes** — ejecutar la misma generación dos veces no duplicará contenido.

### marker_insert

Inserta contenido justo después de un marcador de inicio:

```yaml
patches:
  - kind: marker_insert
    file: src/app.module.ts
    idempotencyKey: "register-{{moduleName}}-module"
    markerStart: "// <scaffoldix:imports>"
    markerEnd: "// </scaffoldix:imports>"
    contentTemplate: |
      import { {{ModuleName}}Module } from './{{moduleName}}/{{moduleName}}.module';
```

### marker_replace

Reemplaza todo el contenido entre marcadores:

```yaml
patches:
  - kind: marker_replace
    file: src/routes/index.ts
    idempotencyKey: "routes-block"
    markerStart: "// <scaffoldix:routes>"
    markerEnd: "// </scaffoldix:routes>"
    contentTemplate: |
      router.use('/{{routePath}}', {{ControllerName}}Router);
```

### append_if_missing

Agrega contenido al final de un archivo solo si no está presente:

```yaml
patches:
  - kind: append_if_missing
    file: .env.example
    idempotencyKey: "env-{{serviceName}}"
    contentTemplate: |
      {{SERVICE_NAME_UPPER}}_PORT=3000
      {{SERVICE_NAME_UPPER}}_URL=http://localhost:3000
```

### regex_replace

Reemplaza contenido que coincide con una expresión regular:

```yaml
patches:
  - kind: regex_replace
    file: package.json
    idempotencyKey: "add-script-{{scriptName}}"
    pattern: '"scripts":\s*\{'
    replacement: '"scripts": { "{{scriptName}}": "node {{scriptFile}}",'
    flags: "m"
```

### json_merge

Fusiona profundamente un objeto JSON en un archivo JSON existente:

```yaml
patches:
  - kind: json_merge
    file: package.json
    idempotencyKey: "add-{{packageName}}-dep"
    content: |
      {
        "dependencies": {
          "{{packageName}}": "^{{packageVersion}}"
        }
      }
```

### yaml_merge

Fusiona profundamente un objeto YAML en un archivo YAML existente:

```yaml
patches:
  - kind: yaml_merge
    file: docker-compose.yml
    idempotencyKey: "add-{{serviceName}}-service"
    content: |
      services:
        {{serviceName}}:
          image: {{imageName}}
          ports:
            - "{{port}}:{{port}}"
```

---

## Hooks y Comprobaciones de Calidad

### Hooks Pre-generación

Comandos que se ejecutan **antes** de que se rendericen las plantillas. Úsalos para validar prerequisitos:

```yaml
preGenerate:
  - command: "node --version"
    description: "Verificar que Node.js está disponible"
  - command: "test -f package.json"
    description: "Asegurarse de estar dentro de un proyecto Node"
```

### Hooks Post-generación

Comandos que se ejecutan **después** de escribir los archivos. Úsalos para instalar dependencias, formatear código, etc.:

```yaml
postGenerate:
  - command: "npm install"
    description: "Instalar nuevas dependencias"
  - command: "npx prettier --write src/{{moduleName}}/**"
    description: "Formatear archivos generados"
```

### Controles de Calidad (Checks)

Comandos que deben pasar para que la generación se confirme. Si algún control falla, todos los archivos generados se revierten:

```yaml
checks:
  - command: "tsc --noEmit"
    description: "Verificación de tipos TypeScript"
  - command: "npm test -- --passWithNoTests"
    description: "Ejecutar pruebas"

parallelChecks: true # ejecutar todos los controles en paralelo
checksTimeout: "120s" # tiempo máximo por control
checksRetries: 2 # reintentar hasta 2 veces en caso de fallo
hooksTimeout: "60s" # tiempo máximo por hook
```

---

## Crear tu Propio Pack

### Paso 1: Inicializar con `init`

```bash
scaffoldix init ./mi-pack
cd mi-pack
```

Esto crea la estructura básica del pack:

```
mi-pack/
├── archetype.yaml
└── templates/
    └── default/
        └── example.ts
```

### Paso 2: Definir el Manifiesto

Edita `archetype.yaml`:

```yaml
pack:
  name: mi-company-pack
  version: "1.0.0"
  description: "Scaffolding estándar para servicios de Mi Empresa"

archetypes:
  - id: rest-service
    templateRoot: templates/rest-service
    inputs:
      - name: serviceName
        type: string
        required: true
        prompt: "Nombre del servicio (ej. OrderService)?"
        transforms:
          - PascalCase
          - camelCase
          - kebab-case

      - name: useAuth
        type: boolean
        default: false
        prompt: "¿Agregar guard de autenticación?"

    postGenerate:
      - command: "npm install"
        description: "Instalar dependencias"

    checks:
      - command: "tsc --noEmit"
        description: "Verificación de tipos"

    patches:
      - kind: append_if_missing
        file: src/index.ts
        idempotencyKey: "export-{{serviceName_camelCase}}"
        contentTemplate: |
          export * from './{{serviceName_camelCase}}/{{serviceName_camelCase}}.service';
```

### Paso 3: Agregar Plantillas

Crea `templates/rest-service/__serviceName_camelCase__.service.ts`:

```handlebars
import { Injectable } from '@nestjs/common';
{{#if useAuth}}
  import { AuthGuard } from '@nestjs/passport';
{{/if}}

@Injectable() export class
{{serviceName_PascalCase}}Service { // Generado por Scaffoldix —
{{pack.name}}
v{{pack.version}}
}
```

### Paso 4: Validar y Probar

```bash
# Validar el manifiesto
scaffoldix pack validate ./mi-pack

# Instalar localmente para pruebas
scaffoldix pack add ./mi-pack

# Ejecutar dry-run
scaffoldix generate mi-company-pack:rest-service --dry-run

# Generar de verdad
scaffoldix generate mi-company-pack:rest-service
```

### Paso 5: Publicar en npm

```bash
# Ver qué se publicaría
scaffoldix pack publish --dry-run

# Publicar
scaffoldix pack publish
```

---

## Uso Avanzado

### Generación No Interactiva (CI/CD)

```bash
# Pasar inputs como clave=valor después de --
scaffoldix generate mi-pack:service --yes -- \
  serviceName="AuthService" \
  useAuth=true \
  module="auth"
```

### Salida JSON para Scripts

```bash
# Obtener lista de packs instalados como JSON
scaffoldix pack list --json | jq '.[].id'

# Obtener arquetipos de un pack como JSON
scaffoldix pack info mi-pack --json | jq '.archetypes[].id'

# Verificar historial de generaciones
scaffoldix history --json | jq '.[0].inputs'
```

### Múltiples Directorios Destino

```bash
# Generar el mismo arquetipo en varios lugares
scaffoldix generate mi-pack:component --target src/components/Button
scaffoldix generate mi-pack:component --target src/components/Input
```

### Archivos Binarios

Scaffoldix detecta automáticamente archivos binarios (imágenes, fuentes, JARs) y los copia tal cual sin procesamiento Handlebars. Para forzar que un archivo de texto se copie sin renderizar, crea un marcador `.binary`:

```bash
touch templates/assets/config.json.binary
```

### El Archivo `.scaffoldixignore`

Dentro del directorio de plantillas de un pack, crea `.scaffoldixignore` para excluir archivos del renderizado:

```gitignore
# No renderizar estos archivos
_helpers/
*.partial.hbs
README.md
```

---

## Solución de Problemas

### `Pack not found` tras agregarlo

```bash
# Verificar que el pack se agregó correctamente
scaffoldix pack list

# Volver a agregar si es necesario
scaffoldix pack add ./mi-pack

# Verificar integridad del registro
scaffoldix doctor
```

### `Template directory does not exist`

El campo `templateRoot` en `archetype.yaml` debe apuntar a un directorio existente relativo a la raíz del pack.

### `Cannot overwrite existing file`

```bash
# Usar --force para permitir sobreescritura
scaffoldix generate mi-pack:service --force

# O usar --dry-run primero para ver qué archivos colisionan
scaffoldix generate mi-pack:service --dry-run
```

### Controles fallando después de la generación

```bash
# Omitir controles durante el desarrollo
scaffoldix generate mi-pack:service --skip-checks

# Ver qué produce el comando fallido
scaffoldix generate mi-pack:service --verbose
```

### Resetear el estado del proyecto

```bash
# Ver el estado actual
cat .scaffoldix/state.json

# Revertir la última generación
scaffoldix rollback

# Resetear completamente (con precaución)
rm -rf .scaffoldix/
```

### Obtener Salida de Debug

```bash
scaffoldix generate mi-pack:service --debug 2>&1 | tee scaffoldix-debug.log
```

---

## Tarjeta de Referencia Rápida

```bash
# Instalar y configurar
npm i -g scaffoldix
scaffoldix doctor
scaffoldix completion zsh >> ~/.zshrc

# Gestión de packs
scaffoldix pack add ./mi-pack
scaffoldix pack add github:org/repo --ref v1.0.0
scaffoldix pack add npm:@empresa/pack
scaffoldix pack list
scaffoldix pack info mi-pack
scaffoldix pack update mi-pack
scaffoldix pack remove mi-pack
scaffoldix pack validate ./mi-pack

# Generar
scaffoldix generate mi-pack:arquetipo
scaffoldix generate mi-pack:arquetipo --dry-run
scaffoldix generate mi-pack:arquetipo --target ./src/modules
scaffoldix generate mi-pack:arquetipo --force
scaffoldix generate mi-pack:arquetipo --skip-checks
scaffoldix generate mi-pack:arquetipo --yes -- clave=valor

# Inspeccionar y deshacer
scaffoldix archetypes
scaffoldix history
scaffoldix rollback --dry-run
scaffoldix rollback --yes

# Autoría
scaffoldix init ./nuevo-pack
scaffoldix pack validate ./nuevo-pack
scaffoldix pack publish --dry-run
```
