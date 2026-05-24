const fs = require('fs');
const path = require('path');

const DATA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'script novos',
  'Script triton 3.2',
  'triton_reset_regions.json'
);

const MAX_SIZE = 4.5 * 1024 * 1024;
const ID_OFFSETS = [0x6000, 0x0a0000];

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

function asciiAt(buffer, offset, length) {
  if (offset + length > buffer.length) return '';
  return buffer
    .subarray(offset, offset + length)
    .toString('latin1')
    .replace(/[^\x20-\x7e]/g, ' ');
}

function readIdentification(buffer) {
  const candidates = ID_OFFSETS.map((offset) => ({
    offset,
    text: asciiAt(buffer, offset, 64),
  }));

  const match = candidates.find(({ text }) => /H[A-Z0-9]{5,8}\s*T[A-Z0-9]{8,14}/.test(text))
    || candidates.find(({ text }) => text.trim());
  const text = match ? match.text.trim().replace(/\s+/g, ' ') : '';
  const id = text.match(/(H[A-Z0-9]{5,8})\s*(T[A-Z0-9]{8,14})/);

  return {
    idOffset: match ? match.offset : null,
    idText: text,
    hw: id ? id[1] : 'NAO IDENTIFICADO',
    sw: id ? id[2] : 'NAO IDENTIFICADO',
  };
}

function expectedBytes(run) {
  if (run.reset_value === '0x00' || run.reset_value === '0xFF') {
    return Buffer.alloc(run.length, Number.parseInt(run.reset_value, 16));
  }
  return Buffer.from(run.rep_sample, 'hex');
}

function isCompatibleRun(buffer, run) {
  const offset = Number.parseInt(run.offset, 16);
  const sample = Buffer.from(run.orig_sample || '', 'hex');
  const target = expectedBytes(run);

  if (!sample.length || offset + run.length > buffer.length) return false;

  for (let i = 0; i < sample.length; i += 1) {
    const current = buffer[offset + i];
    if (current !== sample[i] && current !== target[i]) return false;
  }

  return true;
}

function detectPatch(buffer, rules) {
  for (const rule of rules) {
    if (rule.file_size !== buffer.length) continue;
    if (rule.runs.every((run) => isCompatibleRun(buffer, run))) return rule;
  }

  return null;
}

function writeRun(output, run) {
  const offset = Number.parseInt(run.offset, 16);
  const length = run.length;

  if (offset + length > output.length) {
    throw new Error(`Patch fora do tamanho do arquivo em ${run.offset}`);
  }

  const bytes = expectedBytes(run);
  if (bytes.length !== length) {
    throw new Error(`Run misto incompleto em ${run.offset}`);
  }
  bytes.copy(output, offset);
}

function verifyRun(output, run) {
  const offset = Number.parseInt(run.offset, 16);
  const length = run.length;

  return output.subarray(offset, offset + length).equals(expectedBytes(run));
}

function applyPatch(input, rule) {
  const output = Buffer.from(input);
  let changed = 0;

  for (const run of rule.runs) {
    const offset = Number.parseInt(run.offset, 16);
    const before = Buffer.from(output.subarray(offset, offset + run.length));
    writeRun(output, run);
    const after = output.subarray(offset, offset + run.length);

    for (let i = 0; i < before.length; i += 1) {
      if (before[i] !== after[i]) changed += 1;
    }
  }

  const failedRun = rule.runs.find((run) => !verifyRun(output, run));
  if (failedRun) {
    throw new Error(`Falha na verificacao do patch em ${failedRun.offset}`);
  }

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
    if (!input.length) {
      return json(400, { ok: false, error: 'Envie um arquivo de firmware.' });
    }
    if (input.length > MAX_SIZE) {
      return json(413, { ok: false, error: 'Arquivo acima do limite de 4,5 MB.' });
    }

    const identification = readIdentification(input);
    const rule = detectPatch(input, getRules());
    if (!rule) {
      return json(422, {
        ok: false,
        error: 'Patch compativel nao encontrado para Triton 3.2.',
        details: 'Validacao por tamanho e bytes de referencia nas areas reparaveis. HW/SW sao exibidos, mas nao bloqueiam o reparo.',
      });
    }

    const { output, changed } = applyPatch(input, rule);
    const baseName = decodeURIComponent(event.headers['x-file-name'] || 'triton32.bin')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\.[^.]+$/, '');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${baseName}_reparado.bin"`,
        'x-chip-ok': 'true',
        'x-chip-brand': 'Mitsubishi',
        'x-chip-model': 'L200 Triton 3.2',
        'x-chip-ecu': 'Denso',
        'x-chip-hw': identification.hw,
        'x-chip-sw': identification.sw,
        'x-chip-id-offset': identification.idOffset === null ? '-' : `0x${identification.idOffset.toString(16).toUpperCase()}`,
        'x-chip-patch-base-hw': rule.hw,
        'x-chip-patch-base-sw': rule.sw,
        'x-chip-total-runs': String(rule.runs.length),
        'x-chip-bytes-written': String(rule.total_bytes_changed),
        'x-chip-bytes-changed': String(changed),
      },
      body: output.toString('base64'),
    };
  } catch (error) {
    return json(500, { ok: false, error: error.message || 'Erro ao processar firmware.' });
  }
};
