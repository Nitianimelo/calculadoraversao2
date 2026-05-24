#!/usr/bin/env python3
"""
sid208_sw_locator.py
--------------------
Localiza e classifica os numeros de identificacao (HW / SW) em dumps de
firmware da ECU Siemens/Continental SID208 (Ford Ranger 3.2L).

Premissa central: o OFFSET ABSOLUTO dos numeros de SW MUDA entre versoes
de software (mesmo HW). O que NAO muda e o PADRAO:
  - numero de calibracao  -> contem a assinatura "12A650"
  - numero de strategy/SW -> contem a assinatura "12K532"
  - os dois ficam num campo de 24 bytes, o 12K532 a +0x18 do 12A650.

Por isso a busca e feita por REGEX de padrao, nunca por offset fixo.

Uso:
  python3 sid208_sw_locator.py arquivo.bin                  # 1 arquivo
  python3 sid208_sw_locator.py original.bin reparado.bin    # compara 2+
"""

import re
import sys

# Formato Ford finis: XXXX-NNXNNN-SSS  (ex.: AB39-12A650-AVJ)
# prefixo opcional "P" ou "DS-" ; sufixo de revisao 2-4 chars.
PART_RE = re.compile(
    rb'(?:DS-)?[A-Z]?[A-Z0-9]{4}-12[A-Z][0-9]{3}-[A-Z0-9]{2,4}'
)

# Assinaturas que definem o bloco de SW (independem do offset)
SIG_CAL = b'12A650'   # numero de calibracao do powertrain
SIG_SW  = b'12K532'   # numero de strategy / software
SLOT    = 0x18        # gap fixo: inicio(12K532) - inicio(12A650) = 24 bytes


def find_parts(data: bytes):
    """Retorna lista de (offset, texto) de todos os part numbers Ford."""
    return [(m.start(), m.group().decode('ascii', 'replace'))
            for m in PART_RE.finditer(data)]


def classify(offset: int, text: str, data: bytes) -> str:
    """Classifica um part number pelo contexto ao redor."""
    ctx = data[max(0, offset - 32):offset]
    if b'CONTI' in ctx or b'FRP_FRQ' in ctx:
        return 'HW  (base / Continental - constante entre versoes)'
    if text.startswith('DS-'):
        return 'DS  (dataset / boot - campo separado)'
    if SIG_CAL.decode() in text:
        return 'SW  >> CALIBRACAO (powertrain)'
    if SIG_SW.decode() in text:
        return 'SW  >> STRATEGY / SOFTWARE'
    return 'outro'


def find_sw_block(data: bytes):
    """
    Localiza o bloco de SW pelo padrao: ocorrencia de 12A650 seguida,
    a +0x18, por uma ocorrencia de 12K532. Retorna dict ou None.
    """
    for m in re.finditer(re.escape(SIG_CAL), data):
        # inicio do part number = recua ate achar o inicio da string ASCII
        start_cal = m.start()
        while start_cal > 0 and 0x20 <= data[start_cal - 1] <= 0x7E:
            start_cal -= 1
        cand_sw = start_cal + SLOT
        # confirma 12K532 dentro do slot seguinte
        if SIG_SW in data[cand_sw:cand_sw + 24]:
            start_sw = data.index(SIG_SW, cand_sw) 
            while start_sw > 0 and 0x20 <= data[start_sw - 1] <= 0x7E:
                start_sw -= 1
            def read(o):
                end = o
                while end < len(data) and 0x20 <= data[end] <= 0x7E:
                    end += 1
                return data[o:end].decode('ascii', 'replace')
            return {
                'cal_offset': start_cal, 'cal_text': read(start_cal),
                'sw_offset':  start_sw,  'sw_text':  read(start_sw),
            }
    return None


def report_file(path: str):
    with open(path, 'rb') as f:
        data = f.read()
    print(f'\n{"="*70}\nARQUIVO: {path}   ({len(data)} bytes)\n{"="*70}')

    print('\n-- Todos os part numbers encontrados --')
    for off, txt in find_parts(data):
        print(f'  0x{off:08X}  {txt:<22}  {classify(off, txt, data)}')

    print('\n-- Bloco de SW (busca por padrao 12A650 + 12K532 @ +0x18) --')
    blk = find_sw_block(data)
    if blk:
        print(f'  CALIBRACAO : 0x{blk["cal_offset"]:08X}  {blk["cal_text"]}')
        print(f'  STRATEGY/SW: 0x{blk["sw_offset"]:08X}  {blk["sw_text"]}')
        gap = blk['sw_offset'] - blk['cal_offset']
        print(f'  gap interno: 0x{gap:X} bytes  '
              f'({"OK - padrao confirmado" if gap == SLOT else "ATENCAO"})')
    else:
        print('  bloco de SW nao localizado pelo padrao.')
    return blk


def compare(blocks):
    """Compara os blocos de SW de varios arquivos."""
    print(f'\n{"="*70}\nCOMPARACAO\n{"="*70}')
    valid = [(p, b) for p, b in blocks if b]
    if len(valid) < 2:
        return
    base_path, base = valid[0]
    for path, blk in valid[1:]:
        d_cal = blk['cal_offset'] - base['cal_offset']
        print(f'\n{path}  vs  {base_path}:')
        print(f'  CAL : 0x{base["cal_offset"]:08X} -> 0x{blk["cal_offset"]:08X}'
              f'   (delta {d_cal:+#x} bytes)')
        print(f'  SW  : {base["sw_text"]}  ->  {blk["sw_text"]}')
        if d_cal == 0:
            print('  => mesmo offset. Provavel mesma versao de SW '
                  '(ou reparo que nao tocou o bloco).')
        else:
            print('  => offset DESLOCADO. Versao de SW diferente. '
                  'Use SEMPRE busca por padrao, nunca offset fixo.')


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    blocks = [(p, report_file(p)) for p in sys.argv[1:]]
    if len(blocks) > 1:
        compare(blocks)


if __name__ == '__main__':
    main()
