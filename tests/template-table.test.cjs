const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function harness() {
  let selected = null;
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('app/dashboard/templates/template-table.tsx','utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name === 'react'
    ? { ...React, useId: () => 'test-table', useState: () => [selected, value => { selected = typeof value === 'function' ? value(selected) : value; }] }
    : require(name) });
  return rows => module.exports.TemplateTable({ rows });
}
const rows = [
  { id:'one', name:'Taladro', category:'Herramientas', fieldCount:2, details:React.createElement('p',null,'Detalle del taladro') },
  { id:'two', name:'Brocas', category:'Consumibles', fieldCount:0, details:React.createElement('p',null,'Sin campos asignados') }
];
function findAll(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => findAll(child,predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...findAll(node.props?.children,predicate)];
}
const buttons = tree => findAll(tree,node => node.type === 'button');
const details = tree => findAll(tree,node => node.type === 'tr' && node.props.className === 'ec-template-expanded-row');

test('template table starts compact with all details and actions collapsed', () => {
  const render = harness();
  const tree = render(rows);
  assert.equal(buttons(tree).length,2);
  assert.ok(buttons(tree).every(button => button.props['aria-expanded'] === false));
  assert.ok(details(tree).every(row => row.props.hidden));
  const html = renderToStaticMarkup(tree);
  assert.match(html, /<table/);
  assert.match(html, /Herramientas/);
  assert.doesNotMatch(html, /Detalle del taladro|Sin campos asignados/);
});

test('selection opens exactly one detail and selecting it again collapses it', () => {
  const render = harness();
  let stopped = false;
  buttons(render(rows))[0].props.onClick({ stopPropagation() { stopped=true; } });
  assert.equal(stopped,true);
  assert.equal(buttons(render(rows))[0].props['aria-expanded'],true);
  assert.match(renderToStaticMarkup(render(rows)),/Detalle del taladro/);
  const summary = findAll(render(rows),node => node.type === 'tr' && node.props.className?.startsWith('ec-template-summary'));
  summary[1].props.onClick();
  assert.deepEqual(details(render(rows)).map(row => row.props.hidden),[true,false]);
  assert.doesNotMatch(renderToStaticMarkup(render(rows)),/Detalle del taladro/);
  buttons(render(rows))[1].props.onClick({stopPropagation(){}});
  assert.ok(details(render(rows)).every(row => row.props.hidden));
});

test('refreshed field counts and details keep the same selected template', () => {
  const render = harness();
  buttons(render(rows))[0].props.onClick({stopPropagation(){}});
  const updated = [{...rows[0],fieldCount:3,details:React.createElement('p',null,'Campo nuevo')},rows[1]];
  const tree = render(updated);
  assert.equal(buttons(tree)[0].props['aria-expanded'],true);
  assert.match(renderToStaticMarkup(tree),/Campo nuevo/);
  assert.equal(buttons(tree)[0].props['aria-controls'],details(tree)[0].props.id);
});

test('empty catalogue has useful instructions rather than an empty table', () => {
  const html = renderToStaticMarkup(harness()([]));
  assert.match(html,/Nueva ficha/);
  assert.doesNotMatch(html,/<table/);
});
