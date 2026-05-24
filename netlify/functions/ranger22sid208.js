const fs = require('fs');
const path = require('path');

const DATA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'script novos',
  'Script Ranger 2.2 SID208',
  'sid208_ranger22_reset_regions.json'
);

const FILE_SIZE = 4 * 1024 * 1024;
const MAX_SIZE = 4.5 * 1024 * 1024;
const SLOT = 0x18;
const SIG_CAL = '12A650';
const SIG_SW = '12K532';
const PART_RE = /(?:DS-)?[A-Z]?[A-Z0-9]{4}-12[A-Z][0-9]{3}-[A-Z0-9]{2,4}/g;

let cachedRules;

function getRules() {
  if (!cachedRules) {
    cachedRules = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
      .slice()
      .sort((a, b) => b.total_bytes_changed - a.total_bytes_changed);
  }
  return cachedRules;
}

function readBody(event) {
  if (!event.body) return Buffer.alloc(0);
  if (event.isBase64Encoded) return Buffer.from(event.body, 'base64');
  return Buffer.from(event.body, 'binary');
}

function readAscii(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] >= 0x20 && buffer[end] <= 0x7e) end += 1;
  return buffer.subarray(offset, end).toString('ascii');
}

function identify(buffer) {
  const text = buffer.toString('latin1');
  const parts = [];
  for (const match of text.matchAll(PART_RE)) {
    parts.push({ offset: match.index, text: match[0] });
  }

  const hwPart = parts.find((part) => {
    const ctx = buffer.subarray(Math.max(0, part.offset - 32), part.offset).toString('latin1');
    return ctx.includes('CONTI') || ctx.includes('FRP_FRQ');
  });

  for (const match of text.matchAll(/12A650/g)) {
    let calOffset = match.index;
    while (calOffset > 0 && buffer[calOffset - 1] >= 0x20 && buffer[calOffset - 1] <= 0x7e) {
      calOffset -= 1;
    }

    const slot = calOffset + SLOT;
    const slotText = buffer.subarray(slot, slot + 24).toString('latin1');
    const swSigOffset = slotText.indexOf(SIG_SW);
    if (swSigOffset === -1) continue;

    let swOffset = slot + swSigOffset;
    while (swOffset > 0 && buffer[swOffset - 1] >= 0x20 && buffer[swOffset - 1] <= 0x7e) {
      swOffset -= 1;
    }

    const calText = readAscii(buffer, calOffset);
    const swText = readAscii(buffer, swOffset);
    if (swOffset - calOffset === SLOT && calText.includes(SIG_CAL) && swText.includes(SIG_SW)) {
      return {
        hw: hwPart ? hwPart.text : 'NAO IDENTIFICADO',
        cal: calText,
        sw: swText,
        swVersion: swText.split('-').pop() || 'NAO IDENTIFICADO',
        calOffset,
        swOffset,
        parts,
      };
    }
  }

  return {
    hw: hwPart ? hwPart.text : 'NAO IDENTIFICADO',
    cal: 'NAO IDENTIFICADO',
    sw: 'NAO IDENTIFICADO',
    swVersion: 'NAO IDENTIFICADO',
    calOffset: null,
    swOffset: null,
    parts,
  };
}

function expectedBytes(run) {
  return Buffer.from(run.rep_sample, 'hex');
}

function originalBytes(run) {
  return Buffer.from(run.orig_sample, 'hex');
}

function isCompatibleRun(buffer, run, delta) {
  const offset = Number.parseInt(run.offset, 16) + delta;
  const orig = originalBytes(run);
  const target = expectedBytes(run);
  if (offset < 0 || offset + run.length > buffer.length) return false;

  for (let i = 0; i < run.length; i += 1) {
    const current = buffer[offset + i];
    if (current !== orig[i] && current !== target[i]) return false;
  }
  return true;
}

function isCompatibleRule(buffer, rule, delta) {
  return rule.runs.every((run) => isCompatibleRun(buffer, run, delta));
}

function findCompatiblePatch(buffer, rules) {
  for (const rule of rules) {
    if (rule.file_size !== buffer.length) continue;
    if (isCompatibleRule(buffer, rule, 0)) return { rule, delta: 0 };
  }

  return null;
}

function applyPatch(input, rule, delta) {
  const output = Buffer.from(input);
  let changed = 0;

  for (const run of rule.runs) {
    const offset = Number.parseInt(run.offset, 16) + delta;
    const target = expectedBytes(run);
    for (let i = 0; i < target.length; i += 1) {
      if (output[offset + i] !== target[i]) {
        output[offset + i] = target[i];
        changed += 1;
      }
    }
  }

  const failedRun = rule.runs.find((run) => {
    const offset = Number.parseInt(run.offset, 16) + delta;
    return !output.subarray(offset, offset + run.length).equals(expectedBytes(run));
  });
  if (failedRun) throw new Error(`Falha na verificacao do patch em ${failedRun.offset}`);

  return { output, changed };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Metodo nao permitido.' });
  }

  try {
    const input = readBody(event);
    if (!input.length) return json(400, { ok: false, error: 'Envie um arquivo de firmware.' });
    if (input.length > MAX_SIZE) return json(413, { ok: false, error: 'Arquivo acima do limite de 4,5 MB.' });
    if (input.length !== FILE_SIZE) {
      return json(422, { ok: false, error: 'Dump SID208 invalido: tamanho esperado de 4 MB.' });
    }

    const id = identify(input);
    const detected = findCompatiblePatch(input, getRules());
    if (!detected) {
      return json(422, {
        ok: false,
        error: 'Patch compativel nao encontrado para Ranger 2.2 SID208.',
        details: 'Validacao por bytes de referencia nas areas reparaveis. HW/SW sao exibidos, mas nao bloqueiam o reparo.',
      });
    }

    const { output, changed } = applyPatch(input, detected.rule, detected.delta);
    const baseName = decodeURIComponent(event.headers['x-file-name'] || 'ranger22_sid208.bin')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\.[^.]+$/, '');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${baseName}_reparado.bin"`,
        'x-chip-ok': 'true',
        'x-chip-brand': 'Ford',
        'x-chip-model': 'Ranger 2.2',
        'x-chip-ecu': 'Siemens Continental SID208',
        'x-chip-hw': id.hw,
        'x-chip-cal': id.cal,
        'x-chip-sw': id.sw,
        'x-chip-sw-version': id.swVersion,
        'x-chip-cal-offset': id.calOffset === null ? '-' : `0x${id.calOffset.toString(16).toUpperCase()}`,
        'x-chip-sw-offset': id.swOffset === null ? '-' : `0x${id.swOffset.toString(16).toUpperCase()}`,
        'x-chip-patch-base': detected.rule.patch_id,
        'x-chip-patch-delta': String(detected.delta),
        'x-chip-total-runs': String(detected.rule.runs.length),
        'x-chip-bytes-written': String(detected.rule.total_bytes_changed),
        'x-chip-bytes-changed': String(changed),
      },
      body: output.toString('base64'),
    };
  } catch (error) {
    return json(500, { ok: false, error: error.message || 'Erro ao processar firmware.' });
  }
};
