# Mapa de Regiões de Reset — Firmware L200 Triton (ECU Denso)

Documento de referência para o desenvolvedor. Descreve **onde** e **como** o
arquivo "reparado" difere do "original" nos firmwares da L200 Triton (ECU
Denso). Acompanha o arquivo de dados `triton_reset_regions.json`.

Base empírica: 5 pares original/reparado, 5 versões de SW, 4 hardwares.

---

## 1. O que é o "reparado"

Estado de **reset de adaptação / valores aprendidos** da ECU — o estado em que
o firmware fica após reinicialização (ex.: troca de bateria). As regiões de
adaptação (idle, injetores, fuel trim, memória de falha, etc.) voltam ao valor
default. O resto do firmware (calibração/tune) permanece intacto.

---

## 2. Estrutura validada (5 pares)

Fatos confirmados em todos os 5 pares — o dev pode tratar como sólidos:

1. **Valores de destino do reset:** somente `0x00` e `0xFF`. O reset nunca
   escreve outro valor.
2. **Edição cirúrgica, não "apagar bloco".** Dentro de um mesmo trecho o reset
   zera alguns bytes, põe `0xFF` em outros e **deixa outros intactos**. Não é
   preencher região — é resetar campo a campo.
3. **A identificação nunca é tocada.** O bloco de ID em `0x6000` e o espelho
   ficam intactos no reparado. HW/SW do reparado == do original.
4. **As regiões de reset ficam na área de dados/calibração**, agrupadas em
   poucas "zonas" (1 a 7 por firmware).
5. **O mapa de regiões é por SW, não por HW.** Dois arquivos do mesmo HW
   (`H16ARA6`: `T1D3HDD39Z01` e `T1D3HDD3J101`) têm zonas bem diferentes
   (2 zonas vs 7). Cada SW precisa do seu próprio mapa.

---

## 3. Aviso obrigatório para o dev (ler antes de codar)

As regiões deste documento foram derivadas do **diff** original↔reparado.
O diff só mostra os bytes que naquele ECU estavam **fora do default**. Um campo
de adaptação que já estava no valor default **não aparece no diff** — logo o
mapa abaixo é um **piso (mínimo observado)**, não o contorno exato das tabelas.

Consequência prática:
- **Não** trate estas regiões como "as regiões completas de reset".
- **Não** gere o reparado por pattern-match destes 5 exemplos — vai sub-resetar
  arquivos novos.
- O reset exato exige a tabela de init/defaults da própria firmware. Este
  documento serve para **acelerar** o trabalho do dev (ponto de partida,
  estrutura, ancoragem), não para substituir essa análise.

---

## 4. Regiões de reset por firmware

Zonas = agrupamento de alterações com gap > 0x1000 entre si. Offsets absolutos
(arquivo cru). Detalhe fino (clusters e runs byte a byte) está no JSON.

### T1D3HDD39Z01 — HW H16ARA6 — 1 MB — 146 bytes, 47 runs, 11 clusters, 2 zonas
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0xA01A0` | `0xA02D4` | 309 B |
| 2 | `0xF96AF` | `0xFA6EA` | 4156 B |

### T1D3HDD3J101 — HW H16ARA6 — 1 MB — 1620 bytes, 83 runs, 22 clusters, 7 zonas
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0xA01A0` | `0xA02F1` | 338 B |
| 2 | `0xA52BC` | `0xA534C` | 145 B |
| 3 | `0xA95B4` | `0xAA20D` | 3162 B |
| 4 | `0xAC738` | `0xACA37` | 768 B |
| 5 | `0xE9B49` | `0xE9D39` | 497 B |
| 6 | `0xEDB30` | `0xEE06D` | 1342 B |
| 7 | `0xF9C6C` | `0xFA575` | 2314 B |

### T1D6HDD6M201 — HW H19PRA6 — 1 MB — 57 bytes, 22 runs, 9 clusters, 2 zonas
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0xA01A0` | `0xA01AC` | 13 B |
| 2 | `0xFA220` | `0xFB6F9` | 5338 B |

### T7RDHARD1J01 — HW H12H4D56 — 1 MB — 42 bytes, 14 runs, 7 clusters, 1 zona
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0xC3CF8` | `0xC3F6B` | 628 B |

### TNC2HNC23F01 — HW H1BI45W — 1,5 MB — 213 bytes, 67 runs, 16 clusters, 2 zonas
| Zona | Início | Fim | Tamanho |
|------|--------|-----|---------|
| 1 | `0xDC24C` | `0xDC3C9` | 382 B |
| 2 | `0x16F60D` | `0x1719B0` | 9124 B |

---

## 5. Observações cruzadas

- **Zona de adaptação recorrente em `0xA01A0`:** presente em `T1D3HDD39Z01`,
  `T1D3HDD3J101` e `T1D6HDD6M201` (as três firmwares de 1ª geração, 1 MB).
  Nessas três os primeiros runs (`0xA01A0`–`0xA01AC`) são **os mesmos bytes,
  com o mesmo conteúdo original e o mesmo destino `0x00`** — forte indício de
  tabela de adaptação em posição fixa nessa geração.
- **Gerações distintas têm origem de zona distinta:** 1ª geração inicia o
  reset em `~0xA01A0`; `T7RDHARD1J01` (Denso 2008) em `0xC3CF8`;
  `TNC2HNC23F01` (1,5 MB) em `0xDC24C`. Não existe offset de reset universal.
- **Tamanho de flash varia:** 1 MB nas quatro primeiras, 1,5 MB na
  `TNC2HNC23F01`. Offsets são absolutos e específicos por firmware.
- **Quantidade de alteração varia muito** (42 a 1620 bytes) — depende do quanto
  cada ECU lido estava fora do default, não do tamanho da firmware.

---

## 6. Arquivo de dados — `triton_reset_regions.json`

Lista, por firmware, o detalhamento completo. Esquema:

```
[
  {
    "sw": "T1D3HDD39Z01",        # versao de SW
    "hw": "H16ARA6",             # hardware
    "file_size": 1048576,        # bytes
    "id_block": "0x6000",        # bloco de identificacao (intacto)
    "mirror": "0x0A0000",        # copia do bloco de ID (intacto)
    "total_bytes_changed": 146,
    "n_runs": 47, "n_clusters": 11, "n_zones": 2,
    "zones":    [ {"start","end","length"}, ... ],   # gap > 0x1000
    "clusters": [ {"start","end","length"}, ... ],   # gap <= 32 bytes
    "runs": [                                        # bytes contiguos exatos
      {
        "offset": "0x0A01A0",
        "length": 2,
        "reset_value": "0x00",   # valor uniforme do destino, ou "mixed"
        "orig_sample": "0108",   # ate 16 bytes do original
        "rep_sample":  "0000"    # ate 16 bytes do reparado
      }, ...
    ]
  }, ...
]
```

Granularidade: `zones` para visão macro, `clusters` para tabelas de adaptação,
`runs` para o byte exato. O dev escolhe o nível conforme a necessidade.
