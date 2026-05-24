# Spec de Integração — `sid208_sw_locator`

Documentação para integração do módulo de identificação de firmware da ECU
**Siemens/Continental SID208** (Ford Ranger 3.2L) na base de código.

> Esta spec descreve **o que o módulo faz, o contrato de I/O, os invariantes do
> domínio e as regras de integração**. Não altere a lógica de busca sem ler a
> seção "Invariantes do domínio" — ela codifica fatos empíricos validados em 5
> arquivos reais (3 versões de SW distintas).

---

## 1. Objetivo

Dado um dump de firmware bruto da ECU SID208 (arquivo de 4.194.304 bytes,
extensão `.bin` ou `.MPC` — irrelevante, é binário cru), o módulo:

1. Localiza os números de identificação **Hardware (HW)** e **Software (SW)**.
2. Classifica cada número encontrado por tipo de campo.
3. Reporta o **offset absoluto** de cada campo.

**Escopo: somente leitura/identificação.** O módulo NÃO escreve nem modifica
firmware. Ver seção 7.

---

## 2. Invariantes do domínio (NÃO violar)

Fatos validados empiricamente. Qualquer refactor deve preservá-los:

| # | Invariante | Consequência para o código |
|---|------------|----------------------------|
| 1 | O **offset absoluto** do bloco de SW **muda entre versões de SW** (mesmo HW). Observado: `AVJ` em `0x277124`; `AVA` e `AVE` em `0x276E58` — delta de 716 bytes. | **Proibido hardcodar offset.** A busca é sempre por padrão. |
| 2 | O número de calibração contém sempre a assinatura ASCII `12A650`. O número de strategy/SW contém sempre `12K532`. | Âncoras de busca: `SIG_CAL = b'12A650'`, `SIG_SW = b'12K532'`. |
| 3 | O `12K532` fica sempre em **+0x18 (24 bytes)** do início do `12A650`. Validado nas 3 versões. | `SLOT = 0x18`. É o critério de confirmação do bloco. |
| 4 | As strings são ASCII puro, null-padded (`0x00`), em campos de 24 bytes. | Leitura termina no primeiro byte fora da faixa `0x20–0x7E`. |
| 5 | A string de calibração pode ter prefixo variável (`P` em `PAB39-...`, ausente em `AB39-...`). | **Nunca** ancore no primeiro caractere. Ancore em `12A650`/`12K532`. |
| 6 | `AB39-12A650` aparece em **3 lugares distintos** por arquivo: campo HW (dentro de bloco `CONTI_SID208_FRP_FRQ`), campo SW (o do bloco com gap 0x18) e campo `DS-AB39-...` (dataset/boot). | Para obter o SW, use `find_sw_block()` — **nunca** o primeiro match de `find_parts()`. |
| 7 | Se o `gap interno` sair diferente de `0x18`, o arquivo está corrompido ou o layout mudou. | Tratar como erro, não como sucesso silencioso. |

---

## 3. API pública

Três funções puras + uma função de bloco. Todas recebem `bytes` (conteúdo do
arquivo já carregado em memória).

### `find_parts(data: bytes) -> list[tuple[int, str]]`
Retorna todas as ocorrências de part numbers Ford no padrão
`[prefixo?]XXXX-12YNNN-SSS`.
- **Retorno:** lista de `(offset_absoluto, texto)`. Pode conter HW, SW e DS.
- Não classifica. Use junto de `classify()`.

### `classify(offset: int, text: str, data: bytes) -> str`
Classifica um part number pelo contexto dos 32 bytes anteriores.
- **Retorno:** uma das categorias: `HW`, `DS`, `SW >> CALIBRACAO`,
  `SW >> STRATEGY / SOFTWARE`, `outro`.

### `find_sw_block(data: bytes) -> dict | None`
**Função principal.** Localiza o bloco de SW pelo padrão do invariante #2/#3.
- **Retorno em sucesso:** dict (ver schema na seção 4).
- **Retorno em falha:** `None` (bloco não encontrado pelo padrão).

### `report_file(path: str)` / `main()`
Glue de CLI (impressão formatada). **Não usar na integração** — são para uso
em terminal. Importe apenas as três funções acima.

---

## 4. Contrato de retorno — `find_sw_block`

```python
{
    "cal_offset": int,   # offset absoluto do part number de calibracao
    "cal_text":   str,   # ex.: "PAB39-12A650-AVE"  ou  "AB39-12A650-AVJ"
    "sw_offset":  int,   # offset absoluto do part number de strategy/SW
    "sw_text":    str,   # ex.: "AB39-12K532-AVE"
}
```

Retorna `None` se o padrão não for encontrado.

**Campo derivado recomendado (Codex deve adicionar):** a "versão de SW" útil
para o sistema é o **sufixo de revisão** — o último segmento após o último `-`
(`AVJ`, `AVA`, `AVE`). Extrair com `text.rsplit("-", 1)[-1]`.

---

## 5. Modos de falha e validação obrigatória

O integrador (Codex) **deve** implementar estas verificações antes de confiar
no resultado:

1. **Tamanho do arquivo:** rejeitar se `len(data) != 4_194_304`. Dump fora
   desse tamanho não é um SID208 íntegro.
2. **`find_sw_block` retornou `None`:** erro explícito (`raise`/erro de domínio).
   Não prosseguir com offset assumido.
3. **Gap interno:** `sw_offset - cal_offset` deve ser exatamente `0x18`.
   Se diferente → erro de corrupção/layout (invariante #7).
4. **Assinaturas presentes:** `"12A650" in cal_text` e `"12K532" in sw_text`.
5. **HW esperado (opcional, sanity check):** o campo HW deve existir e bater
   com o HW suportado (validado: `AB39-12A650-FE` dentro do bloco `CONTI`).
   HW divergente = arquivo de outra central.

Princípio: **falhar alto e explícito**. Nunca devolver offset/identificação
"provável" sem o padrão confirmado — isso corromperia gravações futuras.

---

## 6. Regras de integração (do / don't)

**FAÇA:**
- Refatore o script para módulo importável: exponha `find_parts`, `classify`,
  `find_sw_block`; mantenha `main()`/`report_file()` sob `if __name__ ==
  "__main__"` (já estão) ou remova se não houver uso de CLI.
- Crie um wrapper de alto nível para o sistema, ex.:
  ```python
  def identify_firmware(data: bytes) -> dict:
      """Identifica HW/SW de um dump SID208. Levanta erro se invalido."""
      # 1. valida tamanho
      # 2. chama find_sw_block + valida gap 0x18
      # 3. monta dict: {hw, sw_cal, sw_strategy, sw_version, offsets...}
  ```
- Carregue o arquivo inteiro em memória (`bytes`) antes de chamar as funções —
  são 4 MB, sem problema.
- Logue o offset encontrado e a versão de SW em cada identificação (útil para
  auditoria, já que o offset varia).

**NÃO FAÇA:**
- ❌ Hardcodar `0x277124`, `0x276E58` ou qualquer offset (invariante #1).
- ❌ Usar `find_parts(data)[0]` como SW — o primeiro match é HW (invariante #6).
- ❌ Ancorar no primeiro caractere da string (invariante #5).
- ❌ Tratar `gap != 0x18` como aceitável (invariante #7).
- ❌ Assumir que `.MPC` e `.bin` precisam de parsing diferente — são idênticos,
  binário cru.

---

## 7. Fora de escopo — aviso para evolução futura

Este módulo **identifica**, não **grava**. Se o sistema for, no futuro,
escrever um número de SW novo no firmware:

- A string de SW provavelmente entra no cálculo de **checksum** do bloco.
  Trocar a string sem recalcular o checksum **inutiliza a ECU**.
- Gravação exige uma etapa separada: identificar algoritmo e janela de
  checksum. Não construa um "writer" em cima deste módulo sem isso resolvido.

---

## 8. Exemplo de uso (pós-integração)

```python
from sid208_sw_locator import find_sw_block, find_parts, classify

with open(caminho_firmware, "rb") as f:
    data = f.read()

if len(data) != 4_194_304:
    raise ValueError("Dump SID208 invalido: tamanho inesperado")

blk = find_sw_block(data)
if blk is None:
    raise ValueError("Bloco de SW nao localizado pelo padrao")

gap = blk["sw_offset"] - blk["cal_offset"]
if gap != 0x18:
    raise ValueError(f"Gap interno invalido (0x{gap:X}) - firmware corrompido")

sw_version = blk["sw_text"].rsplit("-", 1)[-1]   # ex.: 'AVE'

print(f"SW calibracao : {blk['cal_text']} @ 0x{blk['cal_offset']:08X}")
print(f"SW strategy   : {blk['sw_text']} @ 0x{blk['sw_offset']:08X}")
print(f"Versao de SW  : {sw_version}")
```

---

## 9. Resumo de validação

Módulo testado em 5 arquivos reais (3 versões de SW):

| Versão SW | Offset CAL | Offset SW | Gap | HW |
|-----------|-----------|-----------|-----|-----|
| `AVJ`     | `0x277124`| `0x27713C`| `0x18` ✓ | `AB39-12A650-FE` |
| `AVA`     | `0x276E58`| `0x276E70`| `0x18` ✓ | `AB39-12A650-FE` |
| `AVE`     | `0x276E58`| `0x276E70`| `0x18` ✓ | `AB39-12A650-FE` |

Padrão `12A650 + 12K532 @ +0x18` confirmado em 100% dos casos. Offset absoluto
**não** estável (invariante #1) — busca por padrão é obrigatória.
