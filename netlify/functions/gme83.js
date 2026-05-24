const fs = require('fs');
const path = require('path');

const DATA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'script novos',
  'script E83',
  'gm_e83_reset_regions.json'
);

const FILE_SIZE = 2 * 1024 * 1024;
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
  const sw = readAscii(buffer, 0x3b8, 32).match(/86[A-Z0-9]{14}/);
  const text = buffer.toString('latin1');
  const partMatch = text.match(/AA12629371/);
  return {
    sw: sw ? sw[0] : 'NAO IDENTIFICADO',
    swOffset: '0x3B8',
    part: partMatch ? partMatch[0] : 'NAO IDENTIFICADO',
    partOffset: partMatch ? partMatch.index : null,
  };
}

function byteValue(hex) {
  return Number.parseInt(hex.replace(/^0x/i, ''), 16);
}

function isCompatibleChange(buffer, change) {
  const offset = Number.parseInt(change.offset, 16);
  if (offset >= buffer.length) return false;
  const orig = byteValue(change.orig);
  const rep = byteValue(change.rep);
  return buffer[offset] === orig || buffer[offset] === rep;
}

function scoreRule(buffer, rule, id) {
  let origMatches = 0;
  let targetMatches = 0;

  for (const change of rule.changes) {
    const offset = Number.parseInt(change.offset, 16);
    const orig = byteValue(change.orig);
    const rep = byteValue(change.rep);
    if (buffer[offset] === orig) origMatches += 1;
    if (buffer[offset] === rep) targetMatches += 1;
  }

  return {
    rule,
    origMatches,
    targetMatches,
    swExact: id.sw === rule.sw ? 1 : 0,
  };
}

function detectPatch(buffer, rules, id) {
  const candidates = [];
  for (const rule of rules) {
    if (rule.file_size !== buffer.length) continue;
    if (rule.changes.every((change) => isCompatibleChange(buffer, change))) {
      candidates.push(scoreRule(buffer, rule, id));
    }
  }

  candidates.sort((a, b) => (
    b.swExact - a.swExact
    || b.origMatches - a.origMatches
    || b.rule.total_bytes_changed - a.rule.total_bytes_changed
  ));

  return candidates[0] ? candidates[0].rule : null;
}

function applyPatch(input, rule) {
  const output = Buffer.from(input);
  let changed = 0;

  for (const change of rule.changes) {
    const offset = Number.parseInt(change.offset, 16);
    const rep = byteValue(change.rep);
    if (output[offset] !== rep) {
      output[offset] = rep;
      changed += 1;
    }
  }

  const failedChange = rule.changes.find((change) => output[Number.parseInt(change.offset, 16)] !== byteValue(change.rep));
  if (failedChange) throw new Error(`Falha na verificacao do patch em ${failedChange.offset}`);

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
    if (input.length !== FILE_SIZE) return json(422, { ok: false, error: 'Dump GM E83 invalido: tamanho esperado de 2 MB.' });

    const id = identify(input);
    const rule = detectPatch(input, getRules(), id);
    if (!rule) {
      return json(422, {
        ok: false,
        error: 'Patch compativel nao encontrado para GM E83.',
        details: 'Validacao por bytes de referencia nas areas reparaveis. SW e part number sao exibidos, mas nao bloqueiam o reparo.',
      });
    }

    const { output, changed } = applyPatch(input, rule);
    const baseName = decodeURIComponent(event.headers['x-file-name'] || 'gm_e83.bin')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\.[^.]+$/, '');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${baseName}_reparado.bin"`,
        'x-chip-ok': 'true',
        'x-chip-brand': 'GM',
        'x-chip-model': rule.vehicle,
        'x-chip-ecu': 'GM E83',
        'x-chip-sw': id.sw,
        'x-chip-sw-offset': id.swOffset,
        'x-chip-part': id.part,
        'x-chip-part-offset': id.partOffset === null ? '-' : `0x${id.partOffset.toString(16).toUpperCase()}`,
        'x-chip-patch-base': rule.vehicle,
        'x-chip-patch-sw': rule.sw,
        'x-chip-total-runs': String(rule.changes.length),
        'x-chip-bytes-written': String(rule.total_bytes_changed),
        'x-chip-bytes-changed': String(changed),
      },
      body: output.toString('base64'),
    };
  } catch (error) {
    return json(500, { ok: false, error: error.message || 'Erro ao processar firmware.' });
  }
};
