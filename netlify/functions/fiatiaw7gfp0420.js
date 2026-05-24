const fs = require('fs');
const path = require('path');

const DATA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'script novos',
  'Script 7gF p0420',
  'fiat_iaw7gf_p0420_regions.json'
);

const FILE_SIZE = 1024 * 1024;
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

function identify(buffer) {
  const text = buffer.toString('latin1');
  const match = text.match(/IAW7GFHW[0-9]{3}/);
  const offset = match ? text.indexOf(match[0]) : null;
  const hw = match ? (match[0].match(/HW[0-9]{3}/) || ['NAO IDENTIFICADO'])[0] : 'NAO IDENTIFICADO';
  return {
    idText: match ? match[0] : 'NAO IDENTIFICADO',
    hw,
    idOffset: offset,
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
    if (input.length !== FILE_SIZE) return json(422, { ok: false, error: 'Dump IAW 7GF invalido: tamanho esperado de 1 MB.' });

    const id = identify(input);
    const rule = detectPatch(input, getRules());
    if (!rule) {
      return json(422, {
        ok: false,
        error: 'Patch compativel nao encontrado para Fiat IAW 7GF P0420.',
        details: 'Validacao por bytes de referencia nas areas reparaveis. HW e identificacao sao exibidos, mas nao bloqueiam o reparo.',
      });
    }

    const { output, changed } = applyPatch(input, rule);
    const baseName = decodeURIComponent(event.headers['x-file-name'] || 'fiat_iaw7gf_p0420.bin')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\.[^.]+$/, '');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${baseName}_reparado.bin"`,
        'x-chip-ok': 'true',
        'x-chip-brand': 'Fiat',
        'x-chip-model': 'Linha Leve',
        'x-chip-ecu': 'Magneti Marelli IAW 7GF',
        'x-chip-system': 'P0420',
        'x-chip-id': id.idText,
        'x-chip-hw': id.hw,
        'x-chip-id-offset': id.idOffset === null ? '-' : `0x${id.idOffset.toString(16).toUpperCase()}`,
        'x-chip-patch-base': rule.patch_id,
        'x-chip-patch-hw': rule.hw,
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
