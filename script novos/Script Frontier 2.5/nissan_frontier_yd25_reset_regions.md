# Estudo — Firmware Nissan Frontier 2.5 TDI (motor YD25)

> ESCOPO: estudo próprio deste veículo. Acompanha `nissan_frontier_yd25_reset_regions.json`.

Base empírica: 4 pares original/reparado. 4 versões de SW, 4 hardwares.
Motor YD25 confirmado pela string `OBD_YD25` no flash.

---

## 1. O que é o "reparado"

Estado de **reset de adaptação / valores aprendidos** da ECU. Regiões de
adaptação voltam ao default; o resto do firmware permanece intacto.

---

## 2. ECU e formato

Bloco de identificação com estrutura **tipo Denso** — idêntica em layout à da
L200 Triton (campo `HW+SW` + 3 bytes de versão + string de identificação).
O fabricante exato **não foi confirmado pelo dump** (não há string `Copr.`
nem marca explícita); tratar como "tipo Denso" até confirmação.

Dois tamanhos de flash, com offsets distintos:

| Flash | Bloco ID | Espelho |
|-------|----------|---------|
| 1 MB (1.048.576 B) | `0x6000` | `0x90000` |
| 1,5 MB (1.572.864 B) | `0x8000` | `0xC0000` |

---

## 3. Identificação — estrutura validada

Bloco no offset acima. Layout:
```
[HW]_[SW]  (padding com espaço 0x20)  +  3 bytes versão  +  string de peça
```
- Separador entre HW e SW é o caractere `_` (underscore).
- HW = 7 caracteres. SW = 9–10 caracteres.

| Firmware | HW (flash) | SW (flash) |
|----------|-----------|-----------|
| P1 | `E30RU4D` | `T2F03420A4` |
| P2 | `E52KU4E` | `T2JA5X31C` |
| P3 | `E520U4E` | `T2G25X39E` |
| P4 | `E528U4E` | `T2G35X38E` |

**Atenção — nome do arquivo não confere com o flash.** Exemplos: arquivo do P1
diz `E30RUR`/`T2F04420A4`, flash diz `E30RU4D`/`T2F03420A4`; arquivo do P3 diz
`E520UE4`/`T2G5X39E`, flash diz `E520U4E`/`T2G25X39E`. **Usar sempre o do
flash** — o nome do arquivo é não confiável.

---

## 4. Estrutura de reset — o que foi validado

1. **Valores de destino variam por firmware:** P1→`0x00`; P2→`0x00/0x02`;
   P3→`0x00/0xFF`; P4→`0x00`. Não há um valor de reset único nesta ECU.
2. **Opera em campos de 16/32 bits** — passo dominante `0x2` e `0x4`.
3. **A posição das zonas depende da SW/HW.** Sem offset fixo.
4. **A identificação nunca é tocada** — bloco e espelho ficam intactos.
5. **Sem par de HW repetido nesta amostra** — os 4 firmwares têm HW distinto.
   Logo não há cruzamento possível; cada mapa é de **um par só** → incerteza
   maior (ver seção 6).

---

## 5. Regiões de reset por firmware

Offsets absolutos. Detalhe byte a byte no JSON.

### P1 — HW E30RU4D / SW T2F03420A4 — 1 MB — 383 B / 118 runs / 4 zonas
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0x097DA8` | `0x097DAC` | 5 B |
| 2 | `0x0AF0C8` | `0x0AF0DC` | 21 B |
| 3 | `0x0E1D20` | `0x0E1D3C` | 29 B |
| 4 | `0x0E5A7D` | `0x0E6BF2` | 4470 B |
Destino: `0x00`.

### P2 — HW E52KU4E / SW T2JA5X31C — 1,5 MB — 239 B / 63 runs / 3 zonas
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0x0C02CB` | `0x0C02DF` | 21 B |
| 2 | `0x1203A0` | `0x1203C9` | 42 B |
| 3 | `0x152938` | `0x153D39` | 5122 B |
Destino: `0x00`, `0x02`.

### P3 — HW E520U4E / SW T2G25X39E — 1,5 MB — 539 B / 171 runs / 6 zonas
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0x0C02C0` | `0x0C02D4` | 21 B |
| 2 | `0x0CC000` | `0x0CC050` | 81 B |
| 3 | `0x0D224C` | `0x0D227D` | 50 B |
| 4 | `0x11FFC2` | `0x11FFC5` | 4 B |
| 5 | `0x141884` | `0x1418FC` | 121 B |
| 6 | `0x1521DB` | `0x153A40` | 6246 B |
Destino: `0x00`, `0xFF`.

### P4 — HW E528U4E / SW T2G35X38E — 1,5 MB — 228 B / 42 runs / 1 zona
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0x152217` | `0x153861` | 5707 B |
Destino: `0x00`.

---

## 6. Observações cruzadas

- **Zona pequena recorrente em `~0xC02Cx`:** presente no P2 (`0x0C02CB`) e no
  P3 (`0x0C02C0`), 21 bytes nos dois — logo após o espelho em `0xC0000`. Forte
  indício de tabela de adaptação em posição quase fixa nos firmwares 1,5 MB.
- **Zona principal de reset em `~0x152000–0x154000`** nos três firmwares de
  1,5 MB (P2, P3, P4) — o maior bloco de adaptação. Posição varia um pouco por
  SW mas a faixa é consistente.
- **Sem cruzamento de HW:** diferente do Ducato (P2≡P3) e do Renault, aqui não
  há duas SW da mesma HW. Recomenda-se, se possível, um 2º par de SW vizinha
  por HW para estreitar o mapa (princípio já comprovado nos outros estudos).

---

## 7. Aviso obrigatório para o dev

As regiões saem do **diff** original↔reparado — só revelam campos fora do
default naquele ECU. Cada mapa é o **mínimo observado**, não o contorno
completo. Como esta amostra não tem par de HW repetido, a incerteza é maior
que no Ducato (onde P2≡P3 deu confirmação). Não gere o reparado por
pattern-match destes exemplos.

---

## 8. Arquivo de dados — `nissan_frontier_yd25_reset_regions.json`

Lista por firmware (`type: reset_pair`). Esquema:
```
{
  "sw": "T2JA5X31C", "hw": "E52KU4E",
  "ecu": "Nissan YD25 (bloco de ID tipo Denso; ...)",
  "id_block": "0x8000", "file_size": 1572864,
  "type": "reset_pair",
  "total_bytes_changed": 239, "n_runs": 63, "n_zones": 3,
  "reset_values": ["0x00","0x02"],
  "run_stride_top": [ {"stride":"0x2","count":8}, ... ],
  "zones": [ {"start","end","length"} ],
  "runs":  [ {"offset","length","orig","rep"}, ... ]
}
```
