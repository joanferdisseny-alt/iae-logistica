const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const model = load('lib/inventory/size-catalog.ts');
const variants = [
  { id: 'xl', size: 'XL', quantity: 5, status: 'ok', expiration_date: null },
  { id: 'l', size: 'L', quantity: 0, status: 'ok', expiration_date: null },
  { id: 'm', size: 'M', quantity: 3, status: 'ok', expiration_date: null }
];
test('sizes use natural order, never invent absent sizes, and numeric totals retain zero', () => {
  assert.deepEqual(model.sortedSizeVariants(variants).map(v => v.size), ['M','L','XL']);
  assert.deepEqual(model.sizeTotals([...variants, { id: 'm2', size: 'M', quantity: '2' }]), [
    { size: 'M', quantity: 5 }, { size: 'L', quantity: 0 }, { size: 'XL', quantity: 5 }
  ]);
  assert.equal(variants[0].id, 'xl');
});
test('one garment header shows total, tallies, selected size and original QR-compatible item links', () => {
  const { SizeSummary } = load('app/dashboard/inventory/size-summary.tsx', {
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '../qr-modal': { QrModal: ({ path }) => React.createElement('span', null, path) },
    '@/lib/inventory/size-catalog': model,
    '@/lib/inventory/expiry-status': load('lib/inventory/expiry-status.ts')
  });
  const html = renderToStaticMarkup(React.createElement(SizeSummary, {
    selectedId: 'm', product: { id: 'xl', name: 'MONO', unit: 'unidades', current_stock: 8, size_count: 3, variants }
  }));
  assert.match(html, /<h1[^>]*>MONO<\/h1>/); assert.match(html, /8 unidades en total/);
  assert.match(html, /Sin existencias/); assert.match(html, /href="\/dashboard\/inventory\/m#talla" aria-current="true"/);
  assert.match(html, /\/dashboard\/inventory\/xl/); assert.doesNotMatch(html, /<th scope="row">S<\/th>/);
});
