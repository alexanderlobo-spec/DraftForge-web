# Teste: Proteção contra Conflito de Escrita Concorrente

## O que foi implementado

Proteção otimista de concorrência no DraftForge-web para evitar perda de dados quando o mesmo projeto é editado em múltiplas abas/dispositivos simultaneamente:

- **Antes:** Dois saves concorrentes sobrescreviam silenciosamente um ao outro.
- **Depois:** Detecção automática de conflito; segundo save não sobrescreve; dados salvos em `conflitos/conflito_<timestamp>.json`.

## Cenário de teste

### Setup
1. Abra **duas abas** do DraftForge-web apontando para o mesmo navegador/conta
2. Faça login em ambas
3. Abra o **mesmo projeto** nas duas abas
4. Abra a **mesma cena** nas duas abas

### Teste 1: Detecção de Conflito (Google Drive)

**Na ABA 1:**
1. Digite algumas palavras no editor
2. Deixe o autosave completar (vai mostrar "✓ Salvo" em verde)
3. Confirme que a palavra conta aumentou

**Na ABA 2 (SEM RECARREGAR):**
1. Digite outras palavras diferentes no editor
2. Deixe o autosave disparar (vai esperar 3 segundos)
3. **ESPERADO:** Em vez de "✓ Salvo", o indicador muda para **"⚠ Conflito — clique para recarregar"** com fundo vermelho
4. Mensagem no topo: "⚠ Conflito: o projeto foi salvo em outro dispositivo. Clique no indicador para recarregar."

### Teste 2: Verificar que dados não foram perdidos

Após o conflito em **Aba 2:**
1. Vá no Google Drive → seu projeto → pasta `conflitos/`
2. Deve haver um arquivo `conflito_2026-07-07T12-34-56-123Z.json` (timestamp do momento do conflito)
3. Abra e verifique que o arquivo contém:
   - Seu texto (o que você digitou na Aba 2 quando houve o conflito)
   - A versão completa do projeto, não perdida

### Teste 3: Recarregar após conflito

Na **Aba 2**, com o indicador em estado "Conflito":
1. Clique no indicador vermelho "⚠ Conflito — clique para recarregar"
2. **ESPERADO:** 
   - A cena recarrega com o conteúdo salvo pela Aba 1
   - Indicador volta a "✓ Salvo" (verde)
   - Toast: "Projeto recarregado da versão mais recente"
   - Seu texto digitado na Aba 2 está **preservado no arquivo de conflito**, não perdido

### Teste 4: OneDrive (opcional, mesma sequência)

Repita Teste 1-3 usando OneDrive em vez de Google Drive. Comportamento idêntico:
- Conflito detectado
- Arquivo salvo em `conflitos/` do OneDrive
- Clique recarrega

## O que verificar

✅ **Deve funcionar:**
- Indicador muda para vermelho quando detecta conflito
- Mensagem de aviso aparece (uma única vez por conflito, não repetida)
- Arquivo de conflito é criado no Drive/OneDrive
- Clique recarrega o projeto
- Nenhum dado é perdido

❌ **Se algo der errado:**
- Verifique o console do navegador (F12 → Console) para mensagens de erro
- Confirme que ambas as abas têm o projeto carregado
- Verifique que a Aba 1 salvou com sucesso antes de editar na Aba 2

## Detalhes técnicos

### Como funciona internamente

1. `loadProjectJson(slug)` → cacheia `modifiedTime` (Drive) ou `lastModifiedDateTime` (OneDrive) em `_remoteVersions[slug]`
2. Cada autosave dispara `saveProjectJson(slug, data)`
3. `saveProjectJson()` faz GET dos metadados atuais do arquivo remoto
4. Se `modifiedTime` atual ≠ `modifiedTime` cacheiado → **CONFLITO**
5. Em conflito:
   - Salva o conteúdo local em `conflitos/conflito_<ISO-timestamp>.json`
   - Lança `SaveConflictError`
   - `doSave()` mostra aviso (uma única vez via `conflictAlerted = true`)
   - Tenta novos saves normalmente (cada um gera novo arquivo de conflito se a condição persistir)

### Estados do indicador de save

- `pending` → (vazio, 3s debounce)
- `saving` → "● Salvando…" (amarelo)
- `saved` → "✓ Salvo" (verde)
- `error` → "⚠ Erro ao salvar" (vermelho leve)
- `conflict` → "⚠ Conflito — clique para recarregar" (vermelho vivo com fundo)

### Limitações conhecidas

- Conflitos são detectados apenas no momento do autosave (a cada 3s)
- Se dois salvamentos acontecerem com exatamente o mesmo timestamp (improvável mas teoricamente possível), pode não detectar
- Requer timestamps precisos do Drive/OneDrive (geralmente confiáveis)

## Rollback / Reversão

Se precisar voltar para a versão anterior sem a proteção de conflito:
```bash
git revert 111d119
```

Mas recomendo **manter** essa proteção, pois resolve um bug real de perda de dados.
