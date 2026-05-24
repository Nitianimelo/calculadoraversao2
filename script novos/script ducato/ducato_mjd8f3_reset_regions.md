# Estudo — Firmware Fiat Ducato MultiJet 2.3 (ECU Magneti Marelli MJD 8F3)

> ESCOPO: estudo próprio deste veículo. ECU **Magneti Marelli MJD 8F3** —
> família diferente das anteriores (Denso, Continental, Bosch EDC17). Não
> misturar. Acompanha o arquivo de dados `ducato_mjd8f3_reset_regions.json`.

Base empírica: 4 pares original/reparado. 3 versões de SW, 2 hardwares.

---

## 1. O que é o "reparado"

Estado de **reset de adaptação / valores aprendidos** da ECU. As regiões de
adaptação voltam ao default; o resto do firmware permanece intacto.

---

## 2. Formato de arquivo

Dois formatos aparecem nos dumps — o dev precisa tratar os dois:

| Formato | Tamanho | Conteúdo |
|---------|---------|----------|
| `.MPC` | 2.098.176 B | flash 2 MB + **1024 bytes finais** (padding `0xFF`) |
| `.bin` | 2.097.152 B | flash 2 MB cru |

Os offsets deste estudo são **relativos ao início do flash** (0). Os 1024 bytes
finais do `.MPC` não contêm regiões de reset.

---

## 3. Identificação — estrutura validada

ECU **Magneti Marelli MJD 8F3**. Bloco de identificação em `~0x1D0020`,
ancorado pela assinatura **`AA 55 CC`**. Cada registro: `AA 55 CC` + 1 byte de
tipo + campo ASCII (padding com espaço `0x20`).

| Campo | Offset aprox. | Conteúdo (exemplos) |
|-------|---------------|---------------------|
| SW | `0x1D0025` | `304UBA10` · `2102B950` · `2101B948` |
| Nº Fiat (peça) | `0x1D0035` | `368338215AB` · `355253519` |
| HW | `0x1D004A` | `MJ8F3HW10W` · `MJ8F3HW00B` |

Validado nos 4 arquivos. Âncora de busca confiável: `AA 55 CC`.

**Atenção:** o HW no flash é `MJ8F3HW10W` / `MJ8F3HW00B` (com o `W`); o nome do
arquivo às vezes escreve `MJ8F3H10W` / `MJ8F3H00B`. Usar o do flash.

---

## 4. Estrutura de reset — o que foi validado

1. **Valores de destino do reset:** `0x00` e `0xCE` nos pares limpos (P2/P3).
   Os pares P1/P4 mostram mais valores — ver seção 6.
2. **Opera em campos de 16 bits.** O passo dominante entre alterações é `0x2`
   — o reset trabalha em palavras de 2 bytes.
3. **A posição das zonas depende da SW/HW.** Não há offset fixo.
4. **CONFIRMAÇÃO FORTE — P2 e P3 são byte-idênticos no reset.** As duas SW
   `2102B950` e `2101B948` (mesma HW `MJ8F3HW00B`) resetam **exatamente os
   mesmos 256 bytes** — 0 divergência. O mapa da HW `00B` é de alta confiança.

---

## 5. Regiões de reset por firmware

Offsets relativos ao flash. Detalhe byte a byte no JSON.

### HW MJ8F3HW00B — SW 2102B950 ≡ 2101B948 — 256 B / 160 runs / 2 zonas
*(mapa idêntico nas duas SW — alta confiança)*
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0x1E99D4` | `0x1EA297` | 2244 B |
| 2 | `0x1EEF80` | `0x1EF0F5` | 374 B |
Destino do reset: `0x00` e `0xCE`.

### HW MJ8F3HW10W — SW 304UBA10 — par P1 (.MPC) — 520 B / 188 runs / 11 zonas
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0x1C067B` | `0x1C0684` | 10 B |
| 2 | `0x1C32B8` | `0x1C441B` | 4452 B |
| 3 | `0x1C8DC1` | `0x1C8DC1` | 1 B |
| 4 | `0x1D1960` | `0x1D2E4D` | 5358 B |
| 5 | `0x1D52CC` | `0x1D52CC` | 1 B |
| 6 | `0x1D9953` | `0x1D995F` | 13 B |
| 7 | `0x1DC170` | `0x1DC171` | 2 B |
| 8 | `0x1E166C` | `0x1E166C` | 1 B |
| 9 | `0x1E2F0A` | `0x1E2F0A` | 1 B |
| 10 | `0x1EADE6` | `0x1EADE7` | 2 B |
| 11 | `0x1EE78C` | `0x1EE84F` | 196 B |
Destino: `0x00`, `0x01`, `0x0E`, `0xCE`, `0xFF`.

### HW MJ8F3HW10W — SW 304UBA10 — par P4 (.bin) — 89 B / 54 runs / 7 zonas
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0x1C082E` | `0x1C082F` | 2 B |
| 2 | `0x1C353C` | `0x1C3DB5` | 2170 B |
| 3 | `0x1D0016` | `0x1D0019` | 4 B  ← ver seção 6 |
| 4 | `0x1D163A` | `0x1D2DB5` | 6012 B |
| 5 | `0x1EE007` | `0x1EE007` | 1 B |
| 6 | `0x1FB38E` | `0x1FB38F` | 2 B |
| 7 | `0x1FC8A4` | `0x1FD1EC` | 2377 B |
Destino: `0x00`, `0x01`, `0x4D`, `0x5A`, `0xA5`, `0xB2`, `0xCE`.

---

## 6. Achado importante — P1 e P4 (mesma SW 304UBA10)

P1 e P4 têm a **mesma SW e HW** (confirmado no bloco de ID), mas:
- São **ECUs/dumps diferentes** — os dois originais divergem em 870 bytes
  (dados de adaptação que cada ECU físico tinha — fenômeno esperado).
- **P4 recalcula um checksum.** A zona 3 de P4 (`0x1D0016`–`0x1D0019`, 4 bytes,
  valores `5A 4D A5 B2`) fica **dentro/junto do bloco de identificação** e tem
  cara de checksum: o reparo do P4 atualizou esse valor; o do P1 não tocou ali.

**Implicação para o dev — crítica:** o reset de adaptação na MJD 8F3
provavelmente exige **recálculo de checksum** (a ferramenta que gerou o P4 fez
isso). Resetar as regiões de adaptação **sem** corrigir esse checksum pode
fazer a ECU rejeitar o flash. O algoritmo/janela desse checksum precisa ser
identificado antes de qualquer gravação — é o gargalo real desta ECU.

---

## 7. Aviso obrigatório para o dev

As regiões saem do **diff** original↔reparado — só revelam campos que estavam
fora do default naquele ECU. Mapa de um par = **mínimo observado**, não o
contorno completo. P2≡P3 confirma o mapa da HW `00B`; as demais HW, com um par
só (ou dois divergentes como P1/P4), têm incerteza maior. Não gere o reparado
por pattern-match destes exemplos.

---

## 8. Arquivo de dados — `ducato_mjd8f3_reset_regions.json`

Lista por firmware (`type: reset_pair`). Esquema:
```
{
  "sw": "2102B950", "hw": "MJ8F3HW00B",
  "ecu": "Magneti Marelli MJD 8F3",
  "format": ".MPC (2MB+1024)", "file_size": 2098176,
  "type": "reset_pair",
  "id_sw_offset": "0x1D0025", "id_hw_offset": "~0x1D0049",
  "total_bytes_changed": 256, "n_runs": 160, "n_zones": 2,
  "reset_values": ["0x00","0xCE"],
  "run_stride_top": [ {"stride":"0x2","count":84}, ... ],
  "zones": [ {"start","end","length"} ],
  "runs":  [ {"offset","length","orig","rep"}, ... ]
}
```
