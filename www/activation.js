/* 娟光月影 安卓端注册激活：未激活时全屏遮挡，输入注册码后才能使用 */
(function () {
  const cap = window.Capacitor
  if (!cap) return
  if (window.__gyActivationBooted) return
  // 只有跑在 App 里才拦截；浏览器预览（没有原生平台）不弹注册页
  const isNative = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : false
  if (!isNative) return
  window.__gyActivationBooted = true

  const STYLE = `
  #gyActivate{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:#07070b;display:flex;align-items:center;justify-content:center;padding:18px;font-family:"Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif;color:#f2f2f5}
  #gyActivate .gy-card{width:min(540px,94vw);max-height:100%;overflow:auto;padding:26px 26px 22px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,#15151d 0%,#0d0d13 100%);box-shadow:0 26px 70px rgba(0,0,0,.6)}
  #gyActivate .gy-brand{display:flex;align-items:center;gap:12px;margin-bottom:6px}
  #gyActivate .gy-moon{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 32% 30%,#fdfdfd 0%,#d8d8e0 45%,#8f8f9d 100%);box-shadow:0 0 16px rgba(180,200,255,.35)}
  #gyActivate .gy-name{font-size:20px;font-weight:600;letter-spacing:2px}
  #gyActivate .gy-sub{margin:2px 0 14px;font-size:12px;color:#8f8f9d;line-height:1.7}
  #gyActivate .gy-label{font-size:12px;color:#8f8f9d;margin:14px 0 6px}
  #gyActivate .gy-code{display:flex;align-items:center;gap:10px}
  #gyActivate .gy-code-text{flex:1;min-width:0;font-family:Consolas,Menlo,monospace;font-size:19px;letter-spacing:1.5px;color:#f3ca79;background:#0b0b11;border:1px solid rgba(233,185,91,.28);border-radius:12px;padding:11px 12px;user-select:text;-webkit-user-select:text;text-align:center;word-break:break-all}
  #gyActivate .gy-copy{flex:none;padding:11px 14px;border-radius:12px;background:rgba(233,185,91,.14);border:1px solid rgba(233,185,91,.35);color:#f3ca79;font-size:13px}
  #gyActivate .gy-info{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:10px;font-size:12px;color:#8f8f9d}
  #gyActivate .gy-input{width:100%;margin-top:6px;padding:12px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#0b0b11;color:#f2f2f5;font-size:15px;letter-spacing:1px;outline:none;text-transform:uppercase}
  #gyActivate .gy-input:focus{border-color:rgba(233,185,91,.6)}
  #gyActivate .gy-btn{width:100%;margin-top:14px;padding:13px;border-radius:13px;border:0;font-size:15px;font-weight:600;color:#221a08;background:linear-gradient(180deg,#f3ca79 0%,#e9b95b 100%)}
  #gyActivate .gy-btn:disabled{opacity:.6}
  #gyActivate .gy-err{min-height:18px;margin-top:9px;font-size:12px;color:#ef6b6b;line-height:1.6}
  #gyActivate .gy-tip{margin-top:14px;font-size:12px;color:#63636f;line-height:1.7}
  /* 车机/小屏横屏（如 820×360）整体压缩，保证按钮和提示完整可见 */
  @media (max-height:520px){
    #gyActivate{padding:8px}
    #gyActivate .gy-card{padding:12px 16px 10px;border-radius:14px}
    #gyActivate .gy-brand{gap:8px;margin-bottom:4px}
    #gyActivate .gy-moon{width:24px;height:24px}
    #gyActivate .gy-name{font-size:16px;letter-spacing:1px}
    #gyActivate .gy-sub{margin:2px 0 8px;font-size:11px;line-height:1.45}
    #gyActivate .gy-label{margin:8px 0 4px;font-size:11px}
    #gyActivate .gy-code-text{padding:8px 10px;font-size:16px;letter-spacing:1px;border-radius:10px}
    #gyActivate .gy-copy{padding:8px 12px;font-size:12px;border-radius:10px}
    #gyActivate .gy-info{margin-top:6px;font-size:11px;gap:4px 12px}
    #gyActivate .gy-input{margin-top:4px;padding:9px 11px;font-size:14px;border-radius:10px}
    #gyActivate .gy-btn{margin-top:10px;padding:10px;font-size:14px;border-radius:11px}
    #gyActivate .gy-err{min-height:15px;margin-top:5px;font-size:11px;line-height:1.45}
    #gyActivate .gy-tip{margin-top:8px;font-size:11px;line-height:1.45}
  }
  `

  let overlay = null

  function ensureOverlay() {
    if (overlay) return overlay
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.appendChild(style)
    overlay = document.createElement('div')
    overlay.id = 'gyActivate'
    overlay.innerHTML = `
      <div class="gy-card">
        <div class="gy-brand"><div class="gy-moon"></div><div class="gy-name">娟光月影</div></div>
        <div class="gy-sub">正在校验软件授权…</div>
      </div>`
    document.body.appendChild(overlay)
    document.documentElement.style.overflow = 'hidden'
    return overlay
  }

  function unmount() {
    if (overlay) overlay.remove()
    overlay = null
    document.documentElement.style.overflow = ''
  }

  function toast(message) {
    const box = document.getElementById('toast')
    if (!box) return
    box.textContent = message
    box.classList.add('show')
    setTimeout(() => box.classList.remove('show'), 2200)
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => copyFallback(text))
      return
    }
    copyFallback(text)
  }

  function copyFallback(text) {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    } catch (err) {
      /* 忽略复制失败 */
    }
  }

  /* 原生调用：优先 nativePromise，其次 Capacitor.Plugins 代理 */
  function callNative(method, payload) {
    const body = payload || {}
    if (typeof cap.nativePromise === 'function') {
      return cap.nativePromise('GyDevice', method, body)
    }
    const plugin = cap.Plugins && cap.Plugins.GyDevice
    if (plugin && typeof plugin[method] === 'function') {
      return plugin[method](body)
    }
    return Promise.reject(new Error('原生桥接不可用'))
  }

  function renderForm(state) {
    ensureOverlay().innerHTML = `
      <div class="gy-card">
        <div class="gy-brand"><div class="gy-moon"></div><div class="gy-name">娟光月影</div></div>
        <div class="gy-sub">软件首次使用需要激活。请把下方机器码发送给管理员获取注册码，激活后即可正常使用。</div>
        <div class="gy-label">本机机器码</div>
        <div class="gy-code">
          <div class="gy-code-text" id="gyMachineCode">${state.code}</div>
          <button class="gy-copy" id="gyCopyCode">复制</button>
        </div>
        <div class="gy-info" id="gyDeviceInfo">${[
          'CPU ' + (state.cpu || '-'),
          (state.cores || '-') + ' 核',
          '内存 ' + (state.memoryGb || '-') + ' GB',
          state.brand || ''
        ].filter(Boolean).join(' · ')}</div>
        <div class="gy-label">注册码</div>
        <input class="gy-input" id="gyCodeInput" placeholder="请输入注册码，如 3F2A-9C71-B0D4-2E88" autocomplete="off" spellcheck="false" />
        <button class="gy-btn" id="gyActivateBtn">激活并开始使用</button>
        <div class="gy-err" id="gyErr"></div>
        <div class="gy-tip">注册码与当前设备的 CPU、内存绑定的机器码唯一对应，换机或恢复出厂后需要重新注册。</div>
      </div>`

    const input = document.getElementById('gyCodeInput')
    const btn = document.getElementById('gyActivateBtn')
    const err = document.getElementById('gyErr')
    document.getElementById('gyCopyCode').onclick = () => {
      copyText(state.code)
      toast('机器码已复制')
    }

    const submit = async () => {
      const value = input.value.trim()
      if (!value) {
        err.textContent = '请先输入注册码'
        return
      }
      btn.disabled = true
      err.textContent = ''
      try {
        const res = await callNative('activate', { code: value })
        if (!res || !res.activated) throw new Error('激活失败')
        unmount()
        toast('激活成功，欢迎使用娟光月影')
      } catch (e) {
        err.textContent = (e && e.message) || '注册码不正确，请核对机器码后重新获取'
        btn.disabled = false
      }
    }

    btn.addEventListener('click', submit)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit()
    })
    input.focus({ preventScroll: true })
  }

  function renderError(message) {
    ensureOverlay().innerHTML = `
      <div class="gy-card">
        <div class="gy-brand"><div class="gy-moon"></div><div class="gy-name">娟光月影</div></div>
        <div class="gy-sub">读取设备信息失败，无法完成授权校验。</div>
        <div class="gy-err" style="min-height:auto;margin-top:14px;">${message}</div>
        <button class="gy-btn" id="gyRetry" style="margin-top:16px;">重新读取设备信息</button>
      </div>`
    document.getElementById('gyRetry').onclick = () => {
      ensureOverlay().innerHTML = `
        <div class="gy-card">
          <div class="gy-brand"><div class="gy-moon"></div><div class="gy-name">娟光月影</div></div>
          <div class="gy-sub">正在校验软件授权…</div>
        </div>`
      check()
    }
  }

  function check() {
    ensureOverlay()
    return callNative('getActivationState')
      .then((state) => {
        if (!state || typeof state.code !== 'string' || !state.code) {
          renderError('设备服务返回数据异常，请点击下方按钮重试')
          return
        }
        if (state.activated) {
          unmount()
          return
        }
        renderForm(state)
      })
      .catch((err) => {
        const reason = err && (err.message || err.error || err)
        renderError((typeof reason === 'string' ? reason : '未知错误') + '（请点击下方按钮重试）')
      })
  }

  check()
})()
