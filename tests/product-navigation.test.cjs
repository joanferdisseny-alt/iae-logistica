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
const model = load('lib/inventory/product-sections.ts');
const Link = ({ children, prefetch, ...props }) => React.createElement('a', props, children);
const icons = load('app/dashboard/icons.tsx');

test('product sections validate input, preserve old history links and do not invent size variants', () => {
  assert.equal(model.resolveProductSection(undefined, false), 'overview');
  assert.equal(model.resolveProductSection(undefined, false, '2'), 'history');
  assert.equal(model.resolveProductSection('sizes', false), 'overview');
  assert.equal(model.resolveProductSection('sizes', true), 'sizes');
  assert.equal(model.resolveProductSection('unknown', true), 'overview');
  assert.equal(model.productSectionHref('item', 'history', 2), '/dashboard/inventory/item?section=history&historyPage=2');
  assert.equal(model.productSectionHref('item', 'stock', 2), '/dashboard/inventory/item?section=stock');
  assert.equal(model.legacyProductSection('#historial'), 'history');
  assert.equal(model.legacyProductSection('#existencias'), 'stock');
  assert.equal(model.legacyProductSection('#talla'), 'stock');
  assert.equal(model.legacyProductSection('#unknown'), undefined);
});

test('product navigation has only applicable sections with one active link and no automatic prefetch', () => {
  const { ProductNavigation } = load('app/dashboard/inventory/product-navigation.tsx', {
    'next/link': Link, 'next/navigation': { useRouter: () => ({}) },
    '@/lib/inventory/product-sections': model, '../icons': icons
  });
  const html = hasSizes => renderToStaticMarkup(React.createElement(ProductNavigation, { itemId: 'item', section: 'stock', hasSizes }));
  assert.match(html(false), /Secciones de la ficha/);
  assert.doesNotMatch(html(false), /section=sizes/);
  assert.match(html(true), /section=sizes/);
  assert.equal((html(true).match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html(true), /Documentos y compatibles/);
});

test('catalogue view switch preserves category, site and search while resetting pagination', () => {
  const { CatalogViews } = load('app/dashboard/catalog/catalog-views.tsx', { 'next/link': Link, '../icons': icons });
  const html = renderToStaticMarkup(React.createElement(CatalogViews, { view: 'list', category: 'A & B', headquarters: 'site', q: 'mono' }));
  assert.match(html, /category=A\+%26\+B&amp;headquarters=site&amp;q=mono/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Por categorías/); assert.match(html, /Listado y stock/);
  assert.doesNotMatch(html, /page=\d/);
});
