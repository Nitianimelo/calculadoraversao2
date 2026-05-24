# Estudo — Firmware L200 Triton 2.4 (ECU Denso)

> ESCOPO: a Triton 2.4 e outro veiculo / outra ECU. NAO misturar com o estudo
> da Triton 3.2 (`triton_3_2_*`). Este arquivo e o estudo proprio da 2.4.

## Estado atual

Recebido 1 arquivo, **somente original** (sem reparado):

| Campo | Valor |
|-------|-------|
| HW | `H1GT45W` |
| SW | `TNQ1HNQ1H102` |
| Denso | 2021 |
| Tamanho | 1,5 MB |

## Identificacao — validada

A estrutura de identificacao da ECU Denso se aplica: bloco em `0x6000`,
`Copr.DENSO` em `+0x23`, campo HW 8 bytes + SW 12 bytes. Confirmado neste
arquivo.

## Pendente

Sem arquivo **reparado** nao ha como mapear as regioes de reset. Para iniciar
o estudo de reset da 2.4 e necessario pelo menos 1 par original/reparado.
Como e geracao Denso mais nova (2021), a estrutura de zonas pode diferir da
3.2 — sera analisada do zero quando o par chegar.
