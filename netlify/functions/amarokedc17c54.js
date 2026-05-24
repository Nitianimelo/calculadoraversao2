const fs = require('fs');
const path = require('path');

const DATA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'script novos',
  'script amarok',
  'amarok_edc17c54_reset_regions.json'
);

const FILE_SIZE = 4 * 1024 * 1024;
const MAX_SIZE = 4.5 * 1024 * 1024;

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

function findIdentification(buffer) {
  const text = buffer.toString('latin1');
  const parts = [...text.matchAll(/03L906012[A-Z0-9]{2}/g)].map((match) => ({
    offset: match.index,
    text: match[0],
  }));
  const swNumbers = [...text.matchAll(/\b[0-9]{4}\b/g)]
    .filter((match) => Math.abs(match.index - (parts[0] ? parts[0].offset : match.index)) < 256)
    .map((match) => ({ offset: match.index, text: match[0] }));

  return {
    part: parts[0] ? parts[0].text : 'NAO IDENTIFICADO',
    partOffset: parts[0] ? parts[0].offset : null,
    sw: swNumbers[0] ? swNumbers[0].text : 'NAO IDENTIFICADO',
  };
}

function expectedBytes(run) {
  return Buffer.from(run.rep_sample, 'hex');
}

function originalBytes(run) {
  return Buffer.from(run.orig_sample, 'hex');
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
    if (input.length !== FILE_SIZE) {
      return json(422, { ok: false, error: 'Dump EDC17C54 invalido: tamanho esperado de 4 MB.' });
    }

    const id = findIdentification(input);
    const rule = detectPatch(input, getRules());
    if (!rule) {
      return json(422, {
        ok: false,
        error: 'Patch compativel nao encontrado para Amarok EDC17C54.',
        details: 'Validacao por bytes de referencia nas areas reparaveis. Part number/SW sao exibidos, mas nao bloqueiam o reparo.',
      });
    }

    const { output, changed } = applyPatch(input, rule);
    const baseName = decodeURIComponent(event.headers['x-file-name'] || 'amarok_edc17c54.bin')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\.[^.]+$/, '');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${baseName}_reparado.bin"`,
        'x-chip-ok': 'true',
        'x-chip-brand': 'Volkswagen',
        'x-chip-model': 'Amarok',
        'x-chip-ecu': 'Bosch EDC17C54',
        'x-chip-part': id.part,
        'x-chip-sw': id.sw,
        'x-chip-id-offset': id.partOffset === null ? '-' : `0x${id.partOffset.toString(16).toUpperCase()}`,
        'x-chip-patch-base': rule.patch_id,
        'x-chip-patch-part': rule.part,
        'x-chip-patch-sw': rule.sw,
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
