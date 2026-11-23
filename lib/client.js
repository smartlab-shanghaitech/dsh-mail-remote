/**
 * Browser half of dsh-mail-remote.
 *
 * Registers one configuration page on the Plugins page for the Loader row
 * `mail-remote` of package `dsh-mail-remote`. The page edits only the volatile
 * fields declared by the Host Config schema, through the shared `configForms`
 * service; saving writes the profile patch and HMR re-applies the entry.
 *
 * Hand-written bundle: no build step, only baseline modules (`react`) and the
 * documented DSH module-loader wrapper.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mail-remote',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'mail-remote'
    const SLOT = 'plugins.row.config'
    const KEY = 'dsh-mail-remote#mail-remote'

    const FIELDS = [
      { key: 'enabled', label: '启用邮箱遥控', type: 'bool' },
      { key: 'provider', label: '邮箱类型', type: 'select', options: [['qq', 'QQ 邮箱'], ['163', '163 邮箱'], ['126', '126 邮箱']] },
      { key: 'user', label: '邮箱地址', type: 'text', placeholder: 'you@qq.com' },
      { key: 'passwordFile', label: '授权码文件', type: 'text', placeholder: '~/.dsh-secrets/qq-mail.pass' },
      { key: 'password', label: '授权码（直接填会写进配置；留空表示不改）', type: 'password', placeholder: '已配置/或改用文件' },
      { key: 'allowFrom', label: '允许的发件人（逗号分隔）', type: 'list', placeholder: 'you@qq.com' },
      { key: 'subjectToken', label: '主题口令', type: 'text', placeholder: '[DSH-7f3a]' },
      { key: 'workdir', label: '工作目录', type: 'text', placeholder: '~/DSH-Remote' },
      { key: 'permissionPreset', label: '会话权限档', type: 'select', options: [['read-only', '只读'], ['workspace-write', '工作区可写']] },
      { key: 'approvalPolicy', label: '审批策略', type: 'select', options: [['never', 'never（无人值守）'], ['ask', 'ask（会挂住）']] },
      { key: 'pollSeconds', label: '轮询间隔（秒）', type: 'number', min: 10, max: 3600 },
      { key: 'maxPerHour', label: '每小时最多执行次数', type: 'number', min: 1, max: 60 },
      { key: 'replyEnabled', label: '执行后回信', type: 'bool' },
      { key: 'skipExisting', label: '首次运行跳过历史邮件', type: 'bool' },
      { key: 'dryRun', label: 'dry-run（只判定，不执行不回信）', type: 'bool' },
    ]

    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '640px', padding: '4px 0' },
      row: { display: 'grid', gridTemplateColumns: '200px 1fr', alignItems: 'center', gap: '10px' },
      label: { fontSize: '13px', opacity: 0.85 },
      input: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(127,127,127,.4)', background: 'transparent', color: 'inherit', fontSize: '13px' },
      note: { fontSize: '12px', opacity: 0.65, lineHeight: 1.6 },
      actions: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' },
      button: { padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(127,127,127,.45)', background: 'rgba(127,127,127,.12)', color: 'inherit', cursor: 'pointer', fontSize: '13px' },
      ok: { fontSize: '12px', color: '#2e9e5b' },
      bad: { fontSize: '12px', color: '#d14b4b' },
    }

    function textOf(value) {
      if (value === undefined || value === null) return ''
      return String(value)
    }

    function toDraft(value) {
      const draft = {}
      for (const field of FIELDS) {
        const raw = value === undefined || value === null ? undefined : value[field.key]
        if (field.type === 'list') draft[field.key] = Array.isArray(raw) ? raw.join(', ') : textOf(raw)
        else if (field.type === 'bool') draft[field.key] = raw === true
        else if (field.type === 'number') draft[field.key] = raw === undefined || raw === null ? '' : Number(raw)
        else draft[field.key] = textOf(raw)
      }
      return draft
    }

    function normalized(field, raw) {
      if (field.type === 'bool') return raw === true
      if (field.type === 'number') {
        if (raw === '' || raw === undefined || raw === null) return undefined
        const parsed = Number(raw)
        return Number.isFinite(parsed) ? parsed : undefined
      }
      if (field.type === 'list') {
        return String(raw ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '')
      }
      return String(raw ?? '').trim()
    }

    function summaryOf(value) {
      if (value === undefined || value === null) return '邮箱遥控'
      if (value.enabled !== true) return '邮箱遥控：未启用'
      const user = textOf(value.user) || '未填邮箱'
      return `邮箱遥控：${user} · 每 ${textOf(value.pollSeconds) || '60'} 秒轮询`
    }

    function makePage(form) {
      return function MailRemoteConfigPage(props) {
        const view = props !== null && typeof props === 'object' && props.view === 'summary' ? 'summary' : 'page'
        const snapshot = React.useSyncExternalStore(
          (onChange) => form.subscribe(onChange),
          () => form.getSnapshot(),
          () => form.getSnapshot(),
        )
        const [draft, setDraft] = React.useState(null)
        const [saving, setSaving] = React.useState(false)
        const [message, setMessage] = React.useState(null)
        const revisionRef = React.useRef(undefined)

        React.useEffect(() => {
          if (snapshot.status === 'ready' && snapshot.revision !== revisionRef.current) {
            revisionRef.current = snapshot.revision
            setDraft(toDraft(snapshot.value))
            setMessage(null)
          }
        }, [snapshot.status, snapshot.revision])

        if (view === 'summary') return h('span', null, summaryOf(snapshot.value))

        if (snapshot.status === 'loading' || draft === null) {
          return h('div', { style: styles.page }, h('p', { style: styles.note }, '正在读取配置…'))
        }
        if (snapshot.status === 'error') {
          return h('div', { style: styles.page }, h('p', { style: styles.bad }, '读取配置失败，请刷新页面重试。'))
        }

        const disabled = snapshot.writable === false || saving
        const setField = (key, value) => setDraft((current) => ({ ...current, [key]: value }))

        const save = async () => {
          const ops = []
          for (const field of FIELDS) {
            const next = normalized(field, draft[field.key])
            if (field.type === 'password' && (next === '' || next === undefined)) continue
            const raw = snapshot.value === undefined ? undefined : snapshot.value[field.key]
            const previous = field.type === 'list' ? (Array.isArray(raw) ? raw : []) : raw
            if (JSON.stringify(next) !== JSON.stringify(previous)) {
              ops.push({ op: 'set', path: [field.key], value: next === undefined ? '' : next })
            }
          }
          if (ops.length === 0) {
            setMessage({ kind: 'note', text: '没有改动' })
            return
          }
          setSaving(true)
          setMessage(null)
          try {
            const accepted = await form.mutate(ops, snapshot.revision)
            setMessage(accepted
              ? { kind: 'ok', text: '已保存并重载插件，下一轮轮询使用新配置。' }
              : { kind: 'bad', text: '保存未被接受：可能被更高层配置覆盖，或值不合法。' })
          } catch (error) {
            setMessage({ kind: 'bad', text: `保存失败：${String(error && error.message ? error.message : error)}` })
          } finally {
            setSaving(false)
          }
        }

        const rows = FIELDS.map((field) => {
          const value = draft[field.key]
          let input
          if (field.type === 'bool') {
            input = h('input', {
              type: 'checkbox',
              checked: value === true,
              disabled,
              onChange: (event) => setField(field.key, event.target.checked),
            })
          } else if (field.type === 'select') {
            input = h('select', {
              style: styles.input,
              value: textOf(value),
              disabled,
              onChange: (event) => setField(field.key, event.target.value),
            }, field.options.map(([optionValue, optionLabel]) => h('option', { key: optionValue, value: optionValue }, optionLabel)))
          } else if (field.type === 'number') {
            input = h('input', {
              style: styles.input,
              type: 'number',
              min: field.min,
              max: field.max,
              value: value === undefined ? '' : value,
              disabled,
              onChange: (event) => setField(field.key, event.target.value),
            })
          } else {
            input = h('input', {
              style: styles.input,
              type: field.type === 'password' ? 'password' : 'text',
              value: textOf(value),
              placeholder: field.placeholder ?? '',
              disabled,
              onChange: (event) => setField(field.key, event.target.value),
            })
          }
          return h('label', { key: field.key, style: styles.row },
            h('span', { style: styles.label }, field.label),
            input)
        })

        return h('div', { style: styles.page },
          rows,
          h('p', { style: styles.note },
            '授权码建议放 0600 文件或环境变量；直接填在这里会随配置写入 profile 的 cordis.patch.yml。',
            ' 保存后插件会热重载，状态文件在 ~/.dsh/mail-remote/state.json。'),
          h('div', { style: styles.actions },
            h('button', { style: styles.button, type: 'button', disabled, onClick: save }, saving ? '保存中…' : '保存'),
            message === null ? null : h('span', { style: message.kind === 'ok' ? styles.ok : message.kind === 'bad' ? styles.bad : styles.note }, message.text),
            snapshot.writable === false ? h('span', { style: styles.note }, '当前配置不可写（被更高层配置锁定）') : null))
      }
    }

    function apply(ctx) {
      const form = ctx.configForms.get(NS)
      const Page = makePage(form)
      ctx.effect(
        () => ctx.configForms.whileServed([NS], () => ctx.slots.inject(SLOT, () => ctx.slots.register({
          name: SLOT,
          key: KEY,
        }, Page))),
        'mail-remote: configuration page',
      )
    }

    const inject = ['slots', 'configForms']
    const exports = { NS, apply, inject }
    return exports
  },
})
