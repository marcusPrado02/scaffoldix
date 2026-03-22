# Scaffoldix — Guia Completo do Usuário

> Uma CLI profissional de scaffolding de código construída sobre packs deterministas, projetada para DevX e Engenharia de Plataformas.

---

## Índice

1. [O que é o Scaffoldix?](#o-que-é-o-scaffoldix)
2. [Instalação](#instalação)
3. [Conceitos Fundamentais](#conceitos-fundamentais)
4. [Guia de Uso Diário](#guia-de-uso-diário)
5. [Referência de Comandos](#referência-de-comandos)
6. [Flags Globais](#flags-globais)
7. [Variáveis e Transformações](#variáveis-e-transformações)
8. [Patchando Arquivos Existentes](#patchando-arquivos-existentes)
9. [Hooks e Controles de Qualidade](#hooks-e-controles-de-qualidade)
10. [Criando seu Próprio Pack](#criando-seu-próprio-pack)
11. [Uso Avançado](#uso-avançado)
12. [Solução de Problemas](#solução-de-problemas)

---

## O que é o Scaffoldix?

O Scaffoldix é uma CLI que automatiza tarefas repetitivas de geração de código usando **packs**. Um pack é uma coleção reutilizável de templates e regras que sabe como gerar código para um propósito específico — como criar um serviço REST, um componente React, uma entidade de banco de dados, ou um projeto completo do zero.

**O que diferencia o Scaffoldix das ferramentas `create-*`:**

- **Packs são versionados e instaláveis** a partir de caminhos locais, repositórios GitHub ou pacotes npm
- **Gera dentro de projetos existentes** — não apenas em projetos novos
- **Patcha arquivos existentes** de forma inteligente (imports, exports, arquivos de configuração) usando operações idempotentes
- **Executa controles de qualidade** (build, test, lint) após a geração e reverte as mudanças se algum falhar
- **Registra cada geração** com um histórico completo e rollback com um único comando
- **Modo dry-run** que mostra exatamente o que vai mudar antes de tocar em qualquer arquivo

---

## Instalação

```bash
# Instalar globalmente com npm
npm install -g scaffoldix

# Ou com pnpm
pnpm add -g scaffoldix

# Verificar a instalação
scaffoldix --version
scaffoldix doctor
```

### Autocompletar no Shell (opcional mas recomendado)

```bash
# Bash
scaffoldix completion bash >> ~/.bashrc && source ~/.bashrc

# Zsh
scaffoldix completion zsh >> ~/.zshrc && source ~/.zshrc

# Fish
scaffoldix completion fish > ~/.config/fish/completions/scaffoldix.fish
```

---

## Conceitos Fundamentais

### Pack

Um **pack** é um diretório que contém um manifesto `archetype.yaml` e uma pasta `templates/`. Ele define um ou mais arquetipos, cada um com seus próprios templates, inputs, patches, hooks e verificações.

```
meu-pack/
├── archetype.yaml        # Manifesto do pack
└── templates/
    └── service/
        └── __entityName__.service.ts  # Arquivo de template
```

### Arquétipo (Archetype)

Um **arquétipo** é uma receita específica de scaffolding dentro de um pack. Um pack para um backend Java pode ter arquetipos como `rest-service`, `repository`, `dto`, etc. Para gerar a partir de um arquétipo específico, usa-se a notação `packId:archetypeId`.

### Template

Templates são arquivos processados pelo motor [Handlebars](https://handlebarsjs.com/). As variáveis são injetadas como `{{nomeVariavel}}`. Marcadores nos nomes de arquivo usam a sintaxe `__nomeVariavel__`.

### Patch

Um **patch** modifica um arquivo que já existe no seu projeto (por exemplo, adiciona um import ao `index.ts`, mescla chaves no `package.json`). Os patches são idempotentes — executar a mesma geração duas vezes não vai duplicar o conteúdo.

### Registro de Packs

Quando você instala um pack, o Scaffoldix o registra em `~/.scaffoldix/registry.json`. Todos os packs instalados ficam disponíveis em todos os seus projetos naquela máquina.

### Estado do Projeto

Cada projeto que usa o Scaffoldix tem um arquivo `.scaffoldix/state.json` que registra cada geração — o que foi criado, o que foi patchado, quais verificações foram executadas.

---

## Guia de Uso Diário

Esta seção cobre os padrões mais comuns do dia a dia.

### Dia 1: Instalar um Pack e Gerar seu Primeiro Arquivo

```bash
# 1. Instalar um pack de um diretório local
scaffoldix pack add ./meu-company-pack

# 2. Ver quais arquetipos o pack oferece
scaffoldix pack info meu-company-pack

# 3. Pré-visualizar o que seria gerado (seguro — não escreve nada)
scaffoldix generate meu-company-pack:service --dry-run

# 4. Gerar de verdade
scaffoldix generate meu-company-pack:service
```

Você será solicitado a fornecer os inputs que o arquétipo exige (por exemplo, nome do serviço, módulo alvo, etc.).

### Adicionando um Pack do GitHub

```bash
# Repositório público (usa a branch padrão)
scaffoldix pack add github:minha-org/scaffoldix-packs

# Tag ou branch específica
scaffoldix pack add github:minha-org/scaffoldix-packs --ref v2.0.0
scaffoldix pack add github:minha-org/scaffoldix-packs --ref main
```

### Adicionando um Pack do npm

```bash
# Versão mais recente
scaffoldix pack add npm:@minha-empresa/scaffoldix-pack

# Versão específica
scaffoldix pack add npm:@minha-empresa/scaffoldix-pack --ref 1.4.0
```

### Gerando no Modo Não Interativo

Ao executar em CI ou em scripts, passe todos os inputs como flags para pular as perguntas:

```bash
scaffoldix generate meu-pack:service \
  --yes \
  --target ./src/services \
  -- serviceName=OrderService module=orders useAuth=true
```

> Os inputs são passados após `--` como pares `chave=valor`.

### Revisando Mudanças Antes de Confirmar

Sempre use `--dry-run` antes de uma geração real para revisar:

```bash
scaffoldix generate meu-pack:entity --dry-run
```

Exemplo de saída:

```
  CREATE  src/entities/Order.entity.ts
  CREATE  src/entities/Order.dto.ts
  MODIFY  src/entities/index.ts       (patch: export-entity-order)
  NOOP    src/app.module.ts           (patch já aplicado)
```

### Desfazendo uma Geração

```bash
# Ver o que o rollback removeria
scaffoldix rollback --dry-run

# Executar o rollback
scaffoldix rollback

# Confirmar sem prompt
scaffoldix rollback --yes
```

> O rollback remove os arquivos que foram **criados** pela última geração. Arquivos patchados devem ser revertidos manualmente (por exemplo, com `git checkout`).

### Atualizando um Pack

```bash
# Atualizar para a versão mais recente
scaffoldix pack update meu-company-pack

# Atualizar para uma versão específica
scaffoldix pack update meu-company-pack --ref v2.1.0
```

### Visualizando o Histórico de Gerações

```bash
# Legível por humanos
scaffoldix history

# Com mais entradas
scaffoldix history --limit 50

# JSON para scripts ou editores
scaffoldix history --json
```

### Executando o Diagnóstico

Se algo parecer errado, execute o diagnóstico:

```bash
scaffoldix doctor
```

Verifica: versão do Node.js, disponibilidade do Git, diretório de configuração do Scaffoldix, saúde do registro e mais.

---

## Referência de Comandos

### `scaffoldix generate <packId:archetypeId>`

Gera código a partir de um arquétipo instalado.

```bash
scaffoldix generate meu-pack:service
scaffoldix generate meu-pack:service --target ./src/modules/auth
scaffoldix generate meu-pack:service --dry-run
scaffoldix generate meu-pack:service --force          # sobrescrever arquivos existentes
scaffoldix generate meu-pack:service --skip-checks    # pular controles de qualidade
scaffoldix generate meu-pack:service --skip-patches   # apenas templates
scaffoldix generate meu-pack:service --yes            # sem perguntas, usar padrões
```

| Flag             | Padrão | Descrição                               |
| ---------------- | ------ | --------------------------------------- |
| `--target <dir>` | `.`    | Diretório de saída                      |
| `--dry-run`      | false  | Pré-visualizar sem escrever             |
| `--force`        | false  | Sobrescrever arquivos existentes        |
| `--yes`          | false  | Usar padrões, sem perguntas             |
| `--skip-patches` | false  | Pular operações de patch                |
| `--skip-checks`  | false  | Pular comandos de controle de qualidade |

### `scaffoldix pack add <origem>`

Instalar um pack a partir de um caminho local, URL do GitHub ou pacote npm.

```bash
scaffoldix pack add ./caminho/para/pack          # local
scaffoldix pack add github:org/repo              # GitHub (branch padrão)
scaffoldix pack add github:org/repo --ref v1.0.0 # tag específica
scaffoldix pack add npm:@org/nome-pack           # npm versão mais recente
scaffoldix pack add npm:@org/nome-pack --ref 2.0.0  # versão específica
```

### `scaffoldix pack list`

Listar todos os packs instalados.

```bash
scaffoldix pack list
scaffoldix pack list --json
```

### `scaffoldix pack info <packId>`

Mostrar detalhes de um pack instalado, incluindo todos os arquetipos e inputs.

```bash
scaffoldix pack info meu-pack
scaffoldix pack info meu-pack --json
```

### `scaffoldix pack remove <packId>`

Desinstalar um pack. Não afeta os arquivos já gerados.

```bash
scaffoldix pack remove meu-pack
```

### `scaffoldix pack update <packId>`

Obter a versão mais recente (ou uma ref específica) de um pack.

```bash
scaffoldix pack update meu-pack
scaffoldix pack update meu-pack --ref v2.0.0
```

### `scaffoldix pack validate <caminho>`

Validar um pack antes de publicá-lo ou usá-lo. Verifica sintaxe YAML, conformidade com o schema e correção dos templates.

```bash
scaffoldix pack validate ./meu-pack
scaffoldix pack validate ./meu-pack --strict
```

### `scaffoldix pack verify <packId>`

Verificar a integridade do pack instalado usando hashing SHA-256.

```bash
scaffoldix pack verify meu-pack
```

### `scaffoldix pack search <keyword>`

Pesquisar no registro público de packs.

```bash
scaffoldix pack search react
scaffoldix pack search java spring --json
```

### `scaffoldix pack publish`

Publicar seu pack no npm. Executa validação primeiro.

```bash
scaffoldix pack publish              # do diretório atual
scaffoldix pack publish ./meu-pack  # de um caminho específico
scaffoldix pack publish --dry-run   # ver o que seria publicado
```

### `scaffoldix archetypes`

Listar todos os arquetipos de todos os packs instalados.

```bash
scaffoldix archetypes
scaffoldix archetypes list --json
```

### `scaffoldix history`

Mostrar o histórico de gerações do projeto atual.

```bash
scaffoldix history
scaffoldix history --limit 20
scaffoldix history --json
```

### `scaffoldix rollback`

Desfazer a última geração (remove os arquivos criados).

```bash
scaffoldix rollback
scaffoldix rollback --dry-run   # pré-visualizar o que seria removido
scaffoldix rollback --yes       # pular a confirmação
```

### `scaffoldix init [diretório]`

Inicializar um novo pack de forma interativa.

```bash
scaffoldix init              # no diretório atual
scaffoldix init ./meu-pack   # em um novo diretório
```

### `scaffoldix doctor`

Executar diagnóstico do sistema.

```bash
scaffoldix doctor
```

### `scaffoldix completion <shell>`

Imprimir o script de autocompletar.

```bash
scaffoldix completion bash
scaffoldix completion zsh
scaffoldix completion fish
```

---

## Flags Globais

| Flag        | Descrição                                      |
| ----------- | ---------------------------------------------- |
| `--verbose` | Mostrar saída adicional e informações de tempo |
| `--debug`   | Mostrar toda a saída incluindo traces internos |
| `--silent`  | Suprimir tudo exceto erros                     |
| `--json`    | Saída JSON legível por máquinas                |
| `--help`    | Mostrar ajuda para um comando                  |
| `--version` | Imprimir número de versão                      |

---

## Variáveis e Transformações

### Interpolação Básica de Variáveis

Em arquivos de template (`.ts`, `.yaml`, `.json`, etc.):

```handlebars
export class
{{serviceName}}Service { constructor(private readonly
{{repositoryName}}Repository:
{{repositoryName}}Repository) {} }
```

### Templates em Nomes de Arquivo

Use `__nomeVariavel__` nos nomes de arquivo:

```
templates/
└── __entityName__.entity.ts    →  order.entity.ts  (quando entityName=order)
└── __entityName__.dto.ts       →  order.dto.ts
└── __EntityName__Controller.ts →  OrderController.ts
```

### Transformações Embutidas

Dada a variável `entityName = "order item"`:

| Transformação | Resultado    | Uso no template              |
| ------------- | ------------ | ---------------------------- |
| `camelCase`   | `orderItem`  | `{{entityName_camelCase}}`   |
| `PascalCase`  | `OrderItem`  | `{{entityName_PascalCase}}`  |
| `kebab-case`  | `order-item` | `{{entityName_kebabCase}}`   |
| `snake_case`  | `order_item` | `{{entityName_snakeCase}}`   |
| `UPPER_SNAKE` | `ORDER_ITEM` | `{{entityName_UPPER_SNAKE}}` |
| `lower`       | `order item` | `{{entityName_lower}}`       |
| `upper`       | `ORDER ITEM` | `{{entityName_upper}}`       |
| `title`       | `Order Item` | `{{entityName_title}}`       |
| `dot.case`    | `order.item` | `{{entityName_dotCase}}`     |
| `path/case`   | `order/item` | `{{entityName_pathCase}}`    |

As transformações são declaradas por input no manifesto:

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

### Condicionais no Handlebars

```handlebars
{{#if useAuth}}
  import { AuthGuard } from '@nestjs/passport';
{{/if}}

{{#unless isPublic}}
  @UseGuards(AuthGuard)
{{/unless}}
```

### Loops no Handlebars

```handlebars
{{#each dependencies}}
  import {
  {{this}}
  } from './{{this}}';
{{/each}}
```

---

## Patchando Arquivos Existentes

Os patches modificam arquivos que já existem no seu projeto. São **idempotentes** — executar a mesma geração duas vezes não vai duplicar o conteúdo.

### marker_insert

Insere conteúdo logo após um marcador de início:

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

Substitui todo o conteúdo entre marcadores:

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

Adiciona conteúdo ao final de um arquivo, mas apenas se ainda não estiver presente:

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

Substitui conteúdo que corresponde a uma expressão regular:

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

Mescla profundamente um objeto JSON em um arquivo JSON existente:

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

Mescla profundamente um objeto YAML em um arquivo YAML existente:

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

## Hooks e Controles de Qualidade

### Hooks de Pré-geração

Comandos que rodam **antes** dos templates serem renderizados. Use para validar pré-requisitos:

```yaml
preGenerate:
  - command: "node --version"
    description: "Verificar que o Node.js está disponível"
  - command: "test -f package.json"
    description: "Garantir que estamos dentro de um projeto Node"
```

### Hooks de Pós-geração

Comandos que rodam **depois** dos arquivos serem escritos. Use para instalar dependências, formatar código, etc.:

```yaml
postGenerate:
  - command: "npm install"
    description: "Instalar novas dependências"
  - command: "npx prettier --write src/{{moduleName}}/**"
    description: "Formatar arquivos gerados"
```

### Controles de Qualidade (Checks)

Comandos que devem passar para a geração ser confirmada. Se algum controle falhar, todos os arquivos gerados são revertidos:

```yaml
checks:
  - command: "tsc --noEmit"
    description: "Verificação de tipos TypeScript"
  - command: "npm test -- --passWithNoTests"
    description: "Executar testes"

parallelChecks: true # executar todos os controles em paralelo
checksTimeout: "120s" # tempo máximo por controle
checksRetries: 2 # tentar novamente até 2 vezes em caso de falha
hooksTimeout: "60s" # tempo máximo por hook
```

---

## Criando seu Próprio Pack

### Passo 1: Inicializar com `init`

```bash
scaffoldix init ./meu-pack
cd meu-pack
```

Isso cria a estrutura básica do pack:

```
meu-pack/
├── archetype.yaml
└── templates/
    └── default/
        └── example.ts
```

### Passo 2: Definir o Manifesto

Edite `archetype.yaml`:

```yaml
pack:
  name: meu-company-pack
  version: "1.0.0"
  description: "Scaffolding padrão para serviços da Minha Empresa"

archetypes:
  - id: rest-service
    templateRoot: templates/rest-service
    inputs:
      - name: serviceName
        type: string
        required: true
        prompt: "Nome do serviço (ex: OrderService)?"
        transforms:
          - PascalCase
          - camelCase
          - kebab-case

      - name: useAuth
        type: boolean
        default: false
        prompt: "Adicionar guard de autenticação?"

    postGenerate:
      - command: "npm install"
        description: "Instalar dependências"

    checks:
      - command: "tsc --noEmit"
        description: "Verificação de tipos"

    patches:
      - kind: append_if_missing
        file: src/index.ts
        idempotencyKey: "export-{{serviceName_camelCase}}"
        contentTemplate: |
          export * from './{{serviceName_camelCase}}/{{serviceName_camelCase}}.service';
```

### Passo 3: Adicionar Templates

Crie `templates/rest-service/__serviceName_camelCase__.service.ts`:

```handlebars
import { Injectable } from '@nestjs/common';
{{#if useAuth}}
  import { AuthGuard } from '@nestjs/passport';
{{/if}}

@Injectable() export class
{{serviceName_PascalCase}}Service { // Gerado pelo Scaffoldix —
{{pack.name}}
v{{pack.version}}
}
```

### Passo 4: Validar e Testar

```bash
# Validar o manifesto
scaffoldix pack validate ./meu-pack

# Instalar localmente para testes
scaffoldix pack add ./meu-pack

# Executar dry-run
scaffoldix generate meu-company-pack:rest-service --dry-run

# Gerar de verdade
scaffoldix generate meu-company-pack:rest-service
```

### Passo 5: Publicar no npm

```bash
# Ver o que seria publicado
scaffoldix pack publish --dry-run

# Publicar
scaffoldix pack publish
```

---

## Uso Avançado

### Geração Não Interativa (CI/CD)

```bash
# Passar inputs como chave=valor após --
scaffoldix generate meu-pack:service --yes -- \
  serviceName="AuthService" \
  useAuth=true \
  module="auth"
```

### Saída JSON para Scripts

```bash
# Obter lista de packs instalados como JSON
scaffoldix pack list --json | jq '.[].id'

# Obter arquetipos de um pack como JSON
scaffoldix pack info meu-pack --json | jq '.archetypes[].id'

# Verificar histórico de gerações
scaffoldix history --json | jq '.[0].inputs'
```

### Múltiplos Diretórios de Destino

```bash
# Gerar o mesmo arquétipo em vários lugares
scaffoldix generate meu-pack:component --target src/components/Button
scaffoldix generate meu-pack:component --target src/components/Input
```

### Arquivos Binários

O Scaffoldix detecta automaticamente arquivos binários (imagens, fontes, JARs) e os copia como estão, sem processamento Handlebars. Para forçar que um arquivo de texto seja copiado sem renderização, crie um marcador `.binary`:

```bash
touch templates/assets/config.json.binary
```

### O Arquivo `.scaffoldixignore`

Dentro do diretório de templates de um pack, crie `.scaffoldixignore` para excluir arquivos da renderização:

```gitignore
# Não renderizar esses arquivos
_helpers/
*.partial.hbs
README.md
```

### Fluxo de Trabalho Completo para um Time de Engenharia

Um fluxo típico para times que mantêm packs internos:

```bash
# 1. Equipe de plataforma atualiza o pack e publica nova versão
scaffoldix pack publish   # de dentro do repositório do pack

# 2. Desenvolvedores atualizam o pack instalado
scaffoldix pack update empresa-pack

# 3. Verificar o que mudou nos arquetipos
scaffoldix pack info empresa-pack

# 4. Gerar novo serviço com o pack atualizado
scaffoldix generate empresa-pack:microsservico --dry-run
scaffoldix generate empresa-pack:microsservico

# 5. Se algo der errado, reverter
scaffoldix rollback

# 6. Auditar o histórico completo
scaffoldix history --json
```

---

## Solução de Problemas

### `Pack not found` após adicionar

```bash
# Verificar que o pack foi adicionado corretamente
scaffoldix pack list

# Re-adicionar se necessário
scaffoldix pack add ./meu-pack

# Verificar integridade do registro
scaffoldix doctor
```

### `Template directory does not exist`

O campo `templateRoot` no `archetype.yaml` deve apontar para um diretório existente relativo à raiz do pack.

### `Cannot overwrite existing file`

```bash
# Usar --force para permitir sobrescrita
scaffoldix generate meu-pack:service --force

# Ou usar --dry-run primeiro para ver quais arquivos colidem
scaffoldix generate meu-pack:service --dry-run
```

### Controles falhando após a geração

```bash
# Pular controles durante o desenvolvimento
scaffoldix generate meu-pack:service --skip-checks

# Ver o que o comando falho produz
scaffoldix generate meu-pack:service --verbose
```

### `Path traversal detected`

Uma regra de renomeação no pack contém `..` que escreveria fora do diretório alvo. Esta é uma verificação de segurança — entre em contato com o autor do pack.

### Resetando o estado do projeto

```bash
# Ver o estado atual
cat .scaffoldix/state.json

# Reverter a última geração
scaffoldix rollback

# Resetar completamente (use com cuidado)
rm -rf .scaffoldix/
```

### Obtendo Saída de Debug

```bash
scaffoldix generate meu-pack:service --debug 2>&1 | tee scaffoldix-debug.log
```

---

## Cartão de Referência Rápida

```bash
# Instalar e configurar
npm i -g scaffoldix
scaffoldix doctor
scaffoldix completion zsh >> ~/.zshrc

# Gestão de packs
scaffoldix pack add ./meu-pack
scaffoldix pack add github:org/repo --ref v1.0.0
scaffoldix pack add npm:@empresa/pack
scaffoldix pack list
scaffoldix pack info meu-pack
scaffoldix pack update meu-pack
scaffoldix pack remove meu-pack
scaffoldix pack validate ./meu-pack

# Gerar
scaffoldix generate meu-pack:arquetipo
scaffoldix generate meu-pack:arquetipo --dry-run
scaffoldix generate meu-pack:arquetipo --target ./src/modules
scaffoldix generate meu-pack:arquetipo --force
scaffoldix generate meu-pack:arquetipo --skip-checks
scaffoldix generate meu-pack:arquetipo --yes -- chave=valor

# Inspecionar e desfazer
scaffoldix archetypes
scaffoldix history
scaffoldix rollback --dry-run
scaffoldix rollback --yes

# Autoria
scaffoldix init ./novo-pack
scaffoldix pack validate ./novo-pack
scaffoldix pack publish --dry-run
```
