# Estudo — Firmware Renault Master (ECU Bosch EDC17 C42)

> ESCOPO: estudo próprio deste veículo. ECU **Bosch EDC17 C42** — família
> diferente da L200 Triton (Denso) e do SID208 (Continental). Não misturar.

Documento de referência para o desenvolvedor. Acompanha o arquivo de dados
`renault_master_edc17_reset_regions.json`.

Base empírica: 2 pares original/reparado. 2 versões de SW, 1 hardware.

---

## 1. O que é o "reparado"

Mesmo conceito dos outros estudos: estado de **reset de adaptação / valores
aprendidos** da ECU (estado pós-reinicialização / troca de bateria). A região
de adaptação volta ao default; o resto do firmware permanece intacto.

---

## 2. Identificação — estrutura validada

ECU **Bosch EDC17 C42**, flash de **2 MB**. Identificadores em ASCII dentro do
flash, na região `0x180000`:

| Campo | Offset | Conteúdo (exemplo) |
|-------|--------|--------------------|
| String de SW | `0x18001A` | `10SW0012411095_720` |
| Descritor EDC17 | `0x180077` | `=39/1/EDC17_C42/15/P_1095//r1709_720_///` |

O que distingue as duas SW é o sufixo `_720` / `_750` (visível nos dois
campos). Validado nos 2 arquivos.

**Atenção — códigos do nome do arquivo:** `HW 2265R`, `SW 6964R`, `SW 5844R`
são referências de catálogo da Renault e **não aparecem no flash em ASCII**.
Os identificadores reais embutidos são os Bosch acima. Mapeamento observado:
`6964R` ↔ `_720` · `5844R` ↔ `_750`.

---

## 3. Estrutura de reset — o que foi validado

1. **Zona única e compacta.** Diferente da Triton (várias zonas espalhadas),
   aqui o reset cai numa **única zona de ~4 KB** — uma tabela de adaptação.
2. **Valores de destino do reset:** `0x00` e `0x0A`. (Note: NÃO é `0x00`/`0xFF`
   como na Triton — cada ECU tem seus defaults.)
3. **A tabela tem registros de passo fixo.** O passo dominante entre alterações
   é `0x0C` (12 bytes); os passos `0x18`/`0x30` são múltiplos (registros
   pulados). Estrutura: registros de 12 bytes; o reset zera um **campo de 3
   bytes por registro**, escrevendo o padrão `00 00 0A`.
4. **A posição da zona depende da SW.** Mudou entre as duas versões
   (`0x1AEDAC` → `0x1B09CC`, ~0x1C20 de deslocamento). Não há offset fixo —
   a zona precisa ser localizada por SW.
5. **A identificação nunca é tocada.** O bloco em `0x180000` fica intacto.

---

## 4. Aviso obrigatório para o dev (ler antes de codar)

As regiões foram derivadas do **diff** original↔reparado. O diff só mostra os
registros que naquele ECU estavam **fora do default**. Um registro já no
default **não aparece** — logo o mapa de um par é o **mínimo observado**, não
a extensão completa da tabela.

Não gere o reparado por pattern-match destes 2 exemplos. Para reset exato é
preciso a definição completa da tabela (início, fim, passo de registro, offset
do campo, valor default) — vinda da estrutura da firmware, não do diff.

Aqui, por ser **tabela única de passo fixo**, o caminho determinístico é mais
direto que na Triton: definida a tabela, o reset é "para cada registro, gravar
`00 00 0A` no campo". Mas a definição da tabela ainda precisa ser confirmada
na firmware — este documento dá o ponto de partida.

---

## 5. Regiões de reset por firmware

Offsets absolutos (arquivo cru de 2 MB). Detalhe byte a byte no JSON.

### SW 6964R (`_720`) — HW 2265R — 2 MB — 380 B / 81 runs / 1 zona
| Zona | Início | Fim | Tamanho | Passo registro |
|------|--------|-----|---------|----------------|
| 1 | `0x1AEDAC` | `0x1AFD55` | 4010 B | `0x0C` (12 B) |

### SW 5844R (`_750`) — HW 2265R — 2 MB — 357 B / 69 runs / 1 zona
| Zona | Início | Fim | Tamanho | Passo registro |
|------|--------|-----|---------|----------------|
| 1 | `0x1B09CC` | `0x1B198D` | 4034 B | `0x0C` (12 B) |

Padrão do campo resetado, idêntico nas duas SW: original `0c XX 03` →
reparado `00 00 0a` (campo de 3 bytes por registro de 12).

---

## 6. Observações

- **ECU e família distintas:** Bosch EDC17 C42 — outra lógica de identificação
  e de reset em relação aos estudos Denso/Continental.
- **Reset é por SW:** posição da zona muda entre `_720` e `_750`. Mapa por SW.
- **Estrutura mais regular** que a Triton: zona única, registros de passo fixo,
  campo de reset uniforme — favorável a uma rotina determinística por SW.
- **Próximo passo útil:** um 3º par de SW vizinha estreitaria o mapa (mesmo
  princípio do cruzamento E01∪F01 da Triton); e confirmar na firmware os
  limites reais da tabela tornaria o reset exato.

---

## 7. Arquivo de dados — `renault_master_edc17_reset_regions.json`

Lista por firmware (`type: reset_pair`). Esquema:

```
{
  "renault_sw": "6964R",            # codigo de catalogo Renault (nome do arquivo)
  "bosch_sw_suffix": "_720",        # sufixo real no flash
  "hw": "2265R",
  "ecu": "Bosch EDC17 C42",
  "file_size": 2097152,
  "type": "reset_pair",
  "id_sw_string": "10SW0012411095_720",
  "id_sw_offset": "0x18001A",
  "id_descriptor": "...r1709_720_///",
  "id_descriptor_offset": "0x180077",
  "total_bytes_changed": 380,
  "n_runs": 81, "n_zones": 1,
  "reset_values_observed": ["0x00","0x0A"],
  "run_stride_top": [ {"stride":"0xC","count":37}, ... ],  # passo de registro
  "zones": [ {"start","end","length"} ],
  "runs":  [ {"offset","length","reset_value","orig","rep"}, ... ]
}
```
