const fs = require('fs');
const path = require('path');

const DATA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'script novos',
  'script ducato',
  'ducato_mjd8f3_reset_regions.json'
);

const VALID_SIZES = new Set([2097152, 2098176]);
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

function readAscii(buffer, offset, length) {
  if (offset + length > buffer.length) return '';
  return buffer
    .subarray(offset, offset + length)
    .toString('latin1')
    .replace(/[^\x20-\x7e]/g, ' ')
    .trim();
}

function identify(buffer) {
  const anchor = Buffer.from([0xaa, 0x55, 0xcc]);
  const matches = [];
  let pos = 0;
  while ((pos = buffer.indexOf(anchor, pos)) !== -1) {
    matches.push(pos);
    pos += 1;
  }

  const base = matches.find((offset) => {
    if (offset < 0x1cf000 || offset > 0x1d1000) return false;
    return /304UBA10|[0-9]{4}[A-Z][A-Z0-9]{3}/.test(readAscii(buffer, offset + 4, 16));
  })
    || matches.find((offset) => offset >= 0x1cf000 && offset <= 0x1d1000)
    || matches[0]
    || null;
  const nearby = base === null ? '' : readAscii(buffer, base, 160);
  const swField = base === null ? '' : readAscii(buffer, base + 4, 16);
  const swMatch = swField.match(/304UBA10|[0-9]{4}[A-Z][A-Z0-9]{3}/)
    || nearby.match(/304UBA10|[0-9]{4}[A-Z][A-Z0-9]{3}/);
  const hwMatch = nearby.match(/MJ8F3H?W?[0-9]{2}[A-Z]|MJ8F3HW[0-9]{2}[A-Z]/);

  return {
    idOffset: base,
    sw: swMatch ? swMatch[0] : 'NAO IDENTIFICADO',
    hw: hwMatch ? hwMatch[0] : 'NAO IDENTIFICADO',
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
    if (!VALID_SIZES.has(input.length)) {
      return json(422, { ok: false, error: 'Dump MJD8F3 invalido: tamanho esperado de 2 MB ou 2 MB + 1024 bytes.' });
    }

    const id = identify(input);
    const rule = detectPatch(input, getRules());
    if (!rule) {
      return json(422, {
        ok: false,
        error: 'Patch compativel nao encontrado para Ducato MJD8F3.',
        details: 'Validacao por tamanho e bytes de referencia nas areas reparaveis. HW/SW sao exibidos, mas nao bloqueiam o reparo.',
      });
    }

    const { output, changed } = applyPatch(input, rule);
    const baseName = decodeURIComponent(event.headers['x-file-name'] || 'ducato_mjd8f3.bin')
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
        'x-chip-model': 'Ducato MultiJet 2.3',
        'x-chip-ecu': 'Magneti Marelli MJD8F3',
        'x-chip-hw': id.hw,
        'x-chip-sw': id.sw,
        'x-chip-id-offset': id.idOffset === null ? '-' : `0x${id.idOffset.toString(16).toUpperCase()}`,
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
