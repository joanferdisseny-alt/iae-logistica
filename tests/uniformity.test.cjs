const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const moduleFor = { exports: {} };
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/uniformity/import.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText)(require,moduleFor,moduleFor.exports);
const { parseUniformitySheets, readUniformityFile, validateExcelArchive, uniformitySizes } = moduleFor.exports;
const sheet = data => [{ sheet: 'Hoja1', data }];
const headers = [null, ...uniformitySizes];

test('uniformity: blanks omit non-existent sizes, explicit zero preserves a size and its source', () => {
  const preview = parseUniformitySheets(sheet([
    ['PRIMERA UNIFORMIDAD'], headers,
    ['CHALECO TERMICO', null, 3, 2, 0, 3, 1],
    ['GORRAS SOL', null, null, null, null, null, null, 32],
    [], ['SEGUNDA UNIFORMIDAD'], headers, ['CHAQUETA', null, 15, 28, 24, 24, 16]
  ]));
  assert.equal(preview.garments, 3); assert.equal(preview.rows.length, 11); assert.equal(preview.total, 148); assert.equal(preview.omitted, 10);
  assert.equal(preview.rows.find(r => r.garment === 'CHALECO TERMICO' && r.size === 'L').quantity, 0);
  assert.equal(preview.rows.find(r => r.garment === 'CHALECO TERMICO' && r.size === 'L').source, 'Hoja1!E3');
  assert.ok(!preview.rows.some(r => r.size === 'XS'));
  assert.deepEqual(preview.rows.filter(r => r.garment === 'GORRAS SOL').map(r => r.size), ['SIN TALLA']);
});
test('uniformity: CSV and flat Excel validate rows and keep zeros', async () => {
  const text = 'UNIFORMIDAD;PRENDA;TALLA;CANTIDAD\nPRIMERA UNIFORMIDAD; Mono ;M;5\nPRIMERA UNIFORMIDAD;Mono;L;0\nPRIMERA UNIFORMIDAD;Mono;XL;\n';
  const result = await readUniformityFile(Buffer.from(text), 'Stock.csv');
  assert.equal(result.total, 5); assert.equal(result.rows.length, 2); assert.equal(result.garments, 1); assert.equal(result.omitted, 1);
  assert.match(result.fileHash, /^[a-f0-9]{64}$/);
  assert.ok(result.rows.every(r => r.garment === 'MONO'));
});
test('uniformity: duplicate rows, unknown headers, formulas, negative and fractional quantities fail closed', async () => {
  const base = [['PRIMERA UNIFORMIDAD'], headers];
  for (const qty of [-1, 1.2, Infinity, '=1+1', '1,000', 'unknown', 1000001]) {
    assert.throws(() => parseUniformitySheets(sheet([...base, ['Mono', qty]])));
  }
  assert.throws(() => parseUniformitySheets(sheet([...base, ['Mono', 1], [' mono ', 2]])), /duplicadas/);
  assert.throws(() => parseUniformitySheets(sheet([['OTHER'], headers, ['Mono', 1]])), /Formato/);
  assert.throws(() => parseUniformitySheets(sheet([...base, ['Mono']])), /entre 1 y 2000/);
  assert.throws(() => parseUniformitySheets(sheet([...base, ['Mono', 1, 2, 3, 4, 5, 6, 7, 8]])), /Formato/);
  for (const filename of ['stock.xls', 'stock.xlsm', 'stock.zip']) await assert.rejects(readUniformityFile(Buffer.from('abc'), filename), /Usa un Excel/);
  await assert.rejects(readUniformityFile(Buffer.alloc(1000001), 'stock.xlsx'), /menos de 1 MB/);
  await assert.rejects(readUniformityFile(Buffer.from([0xff]), 'stock.csv'));
});
test('uniformity: malformed or oversized Excel archives are rejected before XML parsing', () => {
  for (const length of [0, 1, 21, 22, 100]) assert.throws(() => validateExcelArchive(Buffer.alloc(length)));
  const buffer = Buffer.alloc(68);
  buffer.writeUInt32LE(0x02014b50, 0); buffer.writeUInt32LE(9000000, 24);
  buffer.writeUInt32LE(0x06054b50, 46); buffer.writeUInt16LE(1, 56);
  assert.throws(() => validateExcelArchive(buffer), /8 MB/);
});
