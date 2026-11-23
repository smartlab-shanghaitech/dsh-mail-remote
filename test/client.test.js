import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)

test('client bundle registers the configuration page and renders its summary', async () => {
  let definition
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  try {
    await import('../lib/client.js')
  } finally {
    delete globalThis.window
  }

  assert.equal(definition.id, 'dsh-mail-remote')
  const exports = definition.factory(require)
  assert.deepEqual(exports.inject, ['slots', 'configForms'])

  const snapshot = {
    status: 'ready',
    value: { enabled: true, user: 'a@qq.com', pollSeconds: 30 },
    base: {},
    user: {},
    revision: 7,
    writable: true,
  }
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
    mutate: async () => true,
  }
  const registrations = []
  const disposers = []
  const ctx = {
    configForms: {
      get: () => form,
      whileServed: (namespaces, register) => {
        const disposer = register(new Set(namespaces))
        return typeof disposer === 'function' ? disposer : () => {}
      },
    },
    slots: {
      inject: (name, factory) => factory(),
      register: (spec, component) => {
        registrations.push({ spec, component })
        return () => {}
      },
    },
    effect: (factory) => {
      const disposer = factory()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
  }

  exports.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.deepEqual(registrations[0].spec, {
    name: 'plugins.row.config',
    key: 'dsh-mail-remote#mail-remote',
  })

  const summary = renderToStaticMarkup(React.createElement(registrations[0].component, { view: 'summary' }))
  assert.ok(summary.includes('a@qq.com'))
  assert.ok(summary.includes('邮箱遥控'))

  for (const dispose of disposers) dispose()
})
