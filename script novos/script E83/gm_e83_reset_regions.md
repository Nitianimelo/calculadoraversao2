# Estudo — Firmware Chevrolet Onix / Spin (ECU GM E83)

> ESCOPO: estudo próprio deste veículo. Acompanha `gm_e83_reset_regions.json`.

Base empírica: 3 pares original/reparado. ECU **GM E83** (Chevrolet Onix /
Spin), flash de **2 MB**.

**Resumo:** este é, de longe, o sistema mais simples dos estudos até aqui. O
reparo altera apenas **2 bytes**.

---

## 1. O que é o "reparado"

Reset de adaptação. Diferente das outras ECUs (que mexem em centenas/milhares
de bytes), aqui o reparo **zera exatamente 2 bytes** — provavelmente um par de
contadores.

---

## 2. Identificação — estrutura validada

ECU **GM E83**, flash 2 MB.

| Campo | Offset | Conteúdo (exemplos) |
|-------|--------|---------------------|
| Código de SW | `0x3B8` | `86ABJT26414520XS` (Onix) · `86ABSW26612620LE` (Spin 1.8) · `86AA472631232290` (Spin AA47) |
| Nº de peça GM | `0x0A54` e repetido | `AA12629371` (recorre a cada ~`0x870` bytes como cabeçalho de bloco) |

Formato do SW: `86` + 4 caracteres + número. Validado nos 3 arquivos.

---

## 3. Estrutura de reset — o que foi validado

1. **O reparo altera exatamente 2 bytes**, ambos para `0x00`. Confirmado nos
   3 pares.
2. **Os 2 bytes ficam sempre a `0x04` de distância** (gap fixo de 4 bytes).
3. **Valores originais pequenos** (`0x05` ou `0x06`) — comportamento de
   contador. A hipótese é um **par de contadores** (DTC / ciclo / adaptação).
4. **Ficam numa janela estreita, `~0x34D9E–0x34DB1`** (~20 bytes), dentro de
   uma região densa de valores pequenos (`00`–`07`). O reparo **não toca** os
   outros valores pequenos ao redor — só os 2 alvos.
5. **A posição absoluta varia um pouco por firmware** (P3 `0x34D9E`, P1
   `0x34DA8`, P2 `0x34DAD`) — deslocamento de ~`0x14` no máximo.

---

## 4. Regiões de reset por firmware

| Firmware | Veículo | Byte 1 | Byte 2 | Gap | Destino |
|----------|---------|--------|--------|-----|---------|
| P1 `86ABJT26414520XS` | Onix | `0x34DA8` (`06`→`00`) | `0x34DAC` (`06`→`00`) | `0x04` | `0x00` |
| P2 `86ABSW26612620LE` | Spin 1.8 | `0x34DAD` (`05`→`00`) | `0x34DB1` (`06`→`00`) | `0x04` | `0x00` |
| P3 `86AA472631232290` | Spin (AA47) | `0x34D9E` (`06`→`00`) | `0x34DA2` (`06`→`00`) | `0x04` | `0x00` |

---

## 5. Observações e hipótese

- **Padrão fortíssimo:** 2 bytes, gap `0x04`, destino `0x00`, valores originais
  de contador (`05`/`06`) — idêntico nos 3 firmwares. Não é coincidência; é
  uma operação de reset bem definida sobre um par de campos.
- **Hipótese de estrutura:** os 2 alvos são duas entradas de uma tabela de
  contadores (entradas separadas por 4 bytes, ou o mesmo campo em 2 registros
  de 4 bytes). A região 0x34D9E–0x34DB1 faz parte de uma tabela maior de
  valores pequenos.
- **O desafio para o dev é localizar os 2 bytes**, não aplicá-los. Estão
  imersos numa região com muitos outros `05`/`06`/`07` — não dá para "achar o
  byte não-zero". A posição varia ~`0x14` entre firmwares.
- **Caminho recomendado:** com só 3 amostras não dá para fixar a regra de
  localização. Mais 2–3 pares triangulariam a posição (a variação é pequena,
  ~20 bytes) e confirmariam se os alvos são índices fixos de uma tabela cujo
  *base* desliza. Aí o reset vira trivial e determinístico: localizar os 2
  índices, gravar `00`.

---

## 6. Aviso para o dev

As posições saem do **diff** de 3 pares. O padrão (2 bytes, gap `0x04`, →`00`)
é consistente e confiável. O que **não** está fechado é a **regra de
localização** da janela `~0x34DA0` — varia por firmware e 3 amostras são
poucas para cravá-la. Não hardcode um offset; trate a localização como item a
fechar com mais pares ou com a definição da tabela.

---

## 7. Arquivo de dados — `gm_e83_reset_regions.json`

Lista por firmware (`type: reset_pair`). Esquema:
```
{
  "vehicle": "Onix", "sw": "86ABJT26414520XS", "ecu": "GM E83",
  "file_size": 2097152, "type": "reset_pair",
  "id_sw_offset": "0x3B8", "gm_part_repeated": "AA12629371",
  "total_bytes_changed": 2,
  "gap_between_changes": "0x4",
  "reset_value": "0x00",
  "changes": [ {"offset":"0x034DA8","orig":"0x06","rep":"0x00"}, ... ]
}
```
