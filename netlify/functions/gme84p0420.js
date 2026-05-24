const fs = require('fs');
const path = require('path');

const DATA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'script novos',
  'Script e84 p0420',
  'gm_e84_p0420_regions.json'
);

const FILE_SIZE = 6 * 1024 * 1024;
const MAX_SIZE = 7 * 1024 * 1024;

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
  const matches = [...text.matchAll(/QQO5E99|12677831|86[A-Z0-9]{10,20}|E84/g)]
    .slice(0, 12)
    .map((match) => `${match[0]}@0x${match.index.toString(16).toUpperCase()}`);
  const sw = (text.match(/QQO5E99|12677831|86[A-Z0-9]{10,20}/) || ['NAO IDENTIFICADO'])[0];
  return {
    sw,
    ids: matches.join(' | ') || 'NAO IDENTIFICADO',
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

function scoreRule(buffer, rule, id) {
  let origMatches = 0;
  for (const run of rule.runs) {
    const offset = Number.parseInt(run.offset, 16);
    const orig = originalBytes(run);
    for (let i = 0; i < run.length; i += 1) {
      if (buffer[offset + i] === orig[i]) origMatches += 1;
    }
  }
  return {
    rule,
    origMatches,
    swExact: id.sw === rule.sw || id.sw === rule.patch_id ? 1 : 0,
  };
}

function detectPatch(buffer, rules, id) {
  const candidates = [];
  for (const rule of rules) {
    if (rule.file_size !== buffer.length) continue;
    if (rule.runs.every((run) => isCompatibleRun(buffer, run))) {
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
    if (input.length > MAX_SIZE) return json(413, { ok: false, error: 'Arquivo acima do limite de 7 MB.' });
    if (input.length !== FILE_SIZE) return json(422, { ok: false, error: 'Dump GM E84 invalido: tamanho esperado de 6 MB.' });

    const id = identify(input);
    const rule = detectPatch(input, getRules(), id);
    if (!rule) {
      return json(422, {
        ok: false,
        error: 'Patch compativel nao encontrado para GM E84 P0420.',
        details: 'Validacao por bytes de referencia nas areas reparaveis. Identificadores sao exibidos, mas nao bloqueiam o reparo.',
      });
    }

    const { output, changed } = applyPatch(input, rule);
    const baseName = decodeURIComponent(event.headers['x-file-name'] || 'gm_e84_p0420.bin')
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
        'x-chip-model': 'Onix',
        'x-chip-ecu': 'GM E84',
        'x-chip-system': 'P0420',
        'x-chip-sw': id.sw,
        'x-chip-id': encodeURIComponent(id.ids),
        'x-chip-patch-base': rule.patch_id,
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
