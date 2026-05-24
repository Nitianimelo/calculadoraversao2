const fs = require('fs');
const path = require('path');

const DATA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'script novos',
  'Script Frontier 2.5',
  'nissan_frontier_yd25_reset_regions.json'
);

const MAX_SIZE = 4.5 * 1024 * 1024;
const ID_OFFSETS_BY_SIZE = {
  1048576: [0x6000, 0x90000],
  1572864: [0x8000, 0xc0000],
};

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
  const offsets = ID_OFFSETS_BY_SIZE[buffer.length] || [0x6000, 0x8000, 0x90000, 0xc0000];
  const candidates = offsets.map((offset) => ({ offset, text: asciiAt(buffer, offset, 96) }));
  const match = candidates.find(({ text }) => /E[A-Z0-9]{6}[_ ]T[A-Z0-9]{8,10}/.test(text))
    || candidates.find(({ text }) => text.trim());

  const text = match ? match.text.trim().replace(/\s+/g, ' ') : '';
  const id = text.match(/(E[A-Z0-9]{6})[_ ](T[A-Z0-9]{8,10})/);

  return {
    idOffset: match ? match.offset : null,
    idText: text,
    hw: id ? id[1] : 'NAO IDENTIFICADO',
    sw: id ? id[2] : 'NAO IDENTIFICADO',
  };
}

function expectedBytes(run) {
  return Buffer.from(run.rep, 'hex');
}

function originalBytes(run) {
  return Buffer.from(run.orig, 'hex');
}

function isCompatibleRun(buffer, run) {
  const offset = Number.parseInt(run.offset, 16);
  const orig = originalBytes(run);
  const target = expectedBytes(run);
  if (offset + run.length > buffer.length) return false;

  for (let i = 0; i < run.length; i += 1) {
    const current = buffer[offset + i];
    if (current !== orig[i] && current !== target[i]) return false;
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

function applyPatch(input, rule) {
  const output = Buffer.from(input);
  let changed = 0;

  for (const run of rule.runs) {
    const offset = Number.parseInt(run.offset, 16);
    const target = expectedBytes(run);
    for (let i = 0; i < target.length; i += 1) {
      if (output[offset + i] !== target[i]) {
        output[offset + i] = target[i];
        changed += 1;
      }
    }
  }

  const failedRun = rule.runs.find((run) => {
    const offset = Number.parseInt(run.offset, 16);
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

    const identification = readIdentification(input);
    const rule = detectPatch(input, getRules());
    if (!rule) {
      return json(422, {
        ok: false,
        error: 'Patch compativel nao encontrado para Frontier 2.5.',
        details: 'Validacao por tamanho e bytes de referencia nas areas reparaveis. HW/SW sao exibidos, mas nao bloqueiam o reparo.',
      });
    }

    const { output, changed } = applyPatch(input, rule);
    const baseName = decodeURIComponent(event.headers['x-file-name'] || 'frontier25.bin')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\.[^.]+$/, '');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${baseName}_reparado.bin"`,
        'x-chip-ok': 'true',
        'x-chip-brand': 'Nissan',
        'x-chip-model': 'Frontier 2.5 YD25',
        'x-chip-ecu': 'Tipo Denso',
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
