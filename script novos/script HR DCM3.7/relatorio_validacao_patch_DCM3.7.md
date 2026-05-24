# Relatório de Validação de Patch — Firmware DCM3.7 (HR)
**Objetivo:** validar se o "reparo" aplicado aos arquivos é o mesmo entre os três pares, mesmo com software diferente. Documento preparado para alimentar uma IA geradora de script.

---

## 1. Veredito (resumo executivo)

| Comparação | Patch idêntico? | Conclusão |
|---|---|---|
| Par 2 (88HR5H0) × Par 3 (ARTEVI) | **SIM — byte a byte** | Mesmos offsets, mesmos valores antigos e novos. Reparo 100% idêntico. |
| Par 1 (COMPASSOR) × Par 2/3 | **MESMA OPERAÇÃO, não os mesmos bytes** | É o mesmo reparo lógico, mas relocado e com diff diferente porque o SW é outro build. |

**Resposta direta à pergunta:** o patch *é o mesmo reparo* nos três casos, mas **não é portável por offset fixo**. O reparo tem dois componentes — um deles é provavelmente idêntico nos três; o outro segue a mesma regra mas gera bytes diferentes porque opera sobre dados que variam por veículo.

> ⚠️ **Implicação crítica para o script:** um script de offset fixo funciona para 88HR5H0 e ARTEVI, mas **corromperia o COMPASSOR** e qualquer outro build. O script tem que ser **baseado em padrão (search & replace / parsing estrutural)**, não em endereço absoluto.

---

## 2. Inventário dos arquivos

Todos os 6 arquivos têm exatamente **2.228.224 bytes (0x220000 = 2 MiB)** — dump completo de ECU Delphi DCM3.7.

| Par | Original | Reparado | md5 ori / rep (12 hex) |
|---|---|---|---|
| 1 — COMPASSOR | `..._PROG_HR_COMPASSOR_ORI_ori_1` | `..._reparado_1.bin` | `dfcc12baa30a` / `b0a8b14f9ac3` |
| 2 — 88HR5H0 | `..._DCM3.7_SW_ATUAL_88HR5H0..._ori_2` | `..._DCM3-reparado_2.bin` | `9b3cc2ab374f` / `55f7aeb095f5` |
| 3 — ARTEVI | `..._PROG_ARTEVI_ORI_ori_3` | `..._reparado_3_.bin` | `5cd40bb65b76` / `0610f7d85ef5` |

**Relação entre os softwares:**
- `ori2` × `ori3`: diferem em apenas **168 bytes** → 88HR5H0 e ARTEVI são o **mesmo build / variantes mínimas**.
- `ori1` × `ori2`: diferem em **1.392.227 bytes** → COMPASSOR é um **build genuinamente diferente**.

---

## 3. Metodologia

Comparação byte a byte (`ori` vs `reparado`) de cada par; agrupamento dos bytes alterados em blocos; comparação cruzada de offsets, valores e conteúdo das regiões reparadas. Resultados:

| Par | Bytes alterados | Envelope do patch | Span |
|---|---|---|---|
| 1 — COMPASSOR | 383 | `0x18DBF6` … `0x193E2B` | 0x6235 |
| 2 — 88HR5H0 | 374 | `0x18B4B6` … `0x1914D4` | 0x601E |
| 3 — ARTEVI | 374 | `0x18B4B6` … `0x1914D4` | 0x601E |

O patch tem **dois componentes** em todos os arquivos:
- **Componente A** — 2 tabelas de calibração (122 bytes alterados em *todos* os pares).
- **Componente B** — uma tabela de registros de falha / DTC (252 bytes no par 2/3; **261** no par 1).

---

## 4. Componente A — Tabelas de calibração

Duas tabelas de 36 words (16‑bit big‑endian), 72 bytes cada. O original é uma **curva descendente**; o reparo **achata o corpo da curva para a constante `0x0AA0`**.

**Tabela original (idêntica nos 3 softwares — byte a byte):**
```
0F DE  0F E6  0F F5  0E 10  0D 48  0C A8  0C 58  0B 90
0A F0  0A A0  09 B0  09 60  08 E8  08 C0  08 98  08 20
07 F8  07 D0  07 80  07 30  07 08  06 E0  06 B8  06 40
05 F0  05 78  04 B0  04 60  03 70  03 20  02 80  02 58
02 30  02 08  01 90  FF 38
```

**Tabela reparada (idêntica nos 3 softwares — byte a byte):**
```
0F DE  0F E6  0F F5  0A A0  0A A0  0A A0  0A A0  0A A0
... (todas as words intermediárias = 0A A0) ...
0A A0  0A A0  0A A0  FF 38
```

**Regra do reparo (Componente A):**
- Preserva as **3 words de cabeçalho** (`0FDE 0FE6 0FF5`).
- Sobrescreve as **32 words do corpo** (índices 3 a 34) com a constante `0x0AA0`.
- Preserva a **word final** (`0xFF38`).

**Verificação de igualdade — Componente A:** as 122 alterações são **idênticas (offset relativo + valor antigo + valor novo) nos 3 pares**. A assinatura da tabela original ocorre exatamente **2× em cada binário** (as duas tabelas, sem falsos positivos) → seguro para search & replace.

➡️ **Componente A é provadamente o mesmo patch nos três arquivos.**

---

## 5. Componente B — Tabela de registros de falha (DTC)

Região logo após as tabelas. Estrutura observada: **registros de 14 bytes**.

```
Registro POPULADO (exemplo):   10 00 00 00 00 AF FF FF 00 00 13 02 00 07
Registro VAZIO  (template):    10 00 00 00 00 00 FF FF 00 00 00 00 00 00
                               └─marcador─┘ │  └id─┘       └código┘ └stat┘
```

O reparo **limpa registros de falha**: zera os campos de dados (id, código de falha, status) de registros selecionados, deixando o esqueleto estrutural (`10 00 ...`, `FF FF`) intacto. Valores escritos pertencem ao alfabeto `{00, 01, 10, FF}` nos 3 pares.

**Verificação de igualdade — Componente B:**
- **Par 2 × Par 3:** região reparada **byte a byte idêntica** (8088 bytes); região original também idêntica.
- **Par 1 × Par 2:** região reparada **diferente** (8333 vs 8088 bytes). As primeiras 69 alterações de DTC coincidem; depois divergem.

**Por que diverge — e por que isso NÃO significa patch diferente:**
A tabela de DTC guarda as falhas *efetivamente registradas naquela ECU específica*. Cada dump tem uma população de falhas diferente. Um registro só pode ser "limpo" se existir. O COMPASSOR tinha 9 registros populados a mais → 261 alterações em vez de 252. **A regra do reparo é a mesma** (zerar registros de falha para o template vazio); apenas o **dado de entrada varia por veículo**.

Conjuntos de códigos limpos largamente sobrepostos entre os pares; as diferenças correspondem a falhas presentes em um dump e ausentes no outro — comportamento esperado, não divergência de patch.

➡️ **Componente B segue a mesma regra de reparo nos três arquivos**, mas o diff de bytes é específico de cada dump.

---

## 6. Conclusão de igualdade

| Item | Par 2 vs 3 | Par 1 vs 2/3 |
|---|---|---|
| Mesmos offsets absolutos | ✅ Sim | ❌ Não (SW diferente, região relocada) |
| Componente A — tabelas (regra + bytes) | ✅ Idêntico | ✅ Idêntico |
| Componente B — DTC (regra de reparo) | ✅ Idêntico | ✅ Mesma regra |
| Componente B — bytes do diff | ✅ Idêntico | ❌ Diferente (dados de falha variam) |
| Patch portável por offset fixo | ✅ Entre si | ❌ Não |

**O reparo é conceitualmente o mesmo nos três arquivos.** Difere apenas em (a) posição absoluta e (b) os bytes exatos do Componente B, ambos consequência direta de SW/dados diferentes — não de um patch diferente.

---

## 7. Especificação técnica para o gerador de script

O script **deve ser baseado em padrão**, nunca em offset fixo. Lógica recomendada:

### 7.1 Componente A — achatar tabelas de calibração
1. Procurar a assinatura de 72 bytes da tabela original (Seção 4). Esperado: **exatamente 2 ocorrências**.
2. Para cada ocorrência, preservar bytes `[0:6]` (3 words de cabeçalho) e os últimos 2 bytes (`FF 38`); preencher o miolo (bytes `6` a `69`, 32 words) com `0A A0` repetido.
3. Abortar/avisar se o número de ocorrências ≠ 2.

### 7.2 Componente B — limpar registros de falha (DTC)
1. Localizar a tabela de DTC por varredura estrutural de registros de 14 bytes iniciados por `10 00 00 00` (não por offset absoluto).
2. Para cada registro **populado** (campos de dados ≠ 0), reescrever para o template vazio: `10 00 00 00 00 00 FF FF 00 00 00 00 00 00`, preservando o framing.
3. Importante: o script deve operar **registro a registro sobre o que existe no arquivo de entrada**, não replicar um diff fixo — senão falhará em dumps com população de falhas diferente.

### 7.3 Validação pós-patch
- Conferir que **apenas** o Componente A e a tabela de DTC foram tocados (envelope esperado: região única e contígua de tabelas + região de DTC).
- Recalcular/corrigir checksum da ECU se aplicável (não avaliado neste estudo — verificar antes de gravar).

### 7.4 Offsets de referência (apenas para validação, NÃO para patch)
| | COMPASSOR | 88HR5H0 / ARTEVI |
|---|---|---|
| Tabela cal. 1 (início corpo) | `0x18DBF6` | `0x18B4B6` |
| Tabela cal. 2 (início corpo) | `0x18DE44` | `0x18B6F6` |
| Região DTC (primeiro byte alterado) | `0x191D9F` | `0x18F53D` |
| Região DTC (último byte alterado) | `0x193E2B` | `0x1914D4` |

O deslocamento entre builds **não é constante** (nem o espaçamento interno entre as duas tabelas) — confirma que offset fixo é inviável.

---

## 8. Ressalvas

- O significado funcional das alterações (qual limitador/curva é a tabela, quais DTCs são limpos) **não foi reverso-engenheirado** — fora do escopo solicitado. O estudo cobre exclusivamente a equivalência do patch.
- Checksum da ECU não foi analisado; validar antes de qualquer gravação.
- Este relatório é uma validação de equivalência, não uma recomendação de gravação em veículo.
