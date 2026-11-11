/* 娟光阅影 安卓端后置补丁：需在 app.js 之后加载 */

/* CapacitorHttp 会把 XMLHttpRequest 接管为原生请求，但不会把 responseType 传下去，
   导致 hls.js 拉取 TS 分片时拿到的是字符串而不是 ArrayBuffer，视频直接报错。
   如果直接换回浏览器原生 XHR，又会受 CORS 限制：大量直播源/片源站不返回
   Access-Control-Allow-Origin，会被 WebView 直接拦截（表现为“有的源能播、有的不能”）。
   这里做混合 XHR：优先用浏览器原生请求（允许 CORS 的站点速度最快），
   一旦被 CORS/混合内容拦截，自动回退到 CapacitorHttp 原生请求，
   并显式传 responseType=arraybuffer，把插件的 base64 数据解码成 ArrayBuffer 交给 hls.js。 */
(function () {
  const NativeXHR = window.CapacitorWebXMLHttpRequest && window.CapacitorWebXMLHttpRequest.fullObject
  if (!NativeXHR || !window.Capacitor || typeof window.Capacitor.nativePromise !== 'function') return
  if (NativeXHR.__gyHybrid) return
  NativeXHR.__gyHybrid = true

  function base64ToArrayBuffer(value) {
    try {
      const binary = atob(value)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return bytes.buffer
    } catch (err) {
      return null
    }
  }

  function GyXHR() {
    this.readyState = 0
    this.status = 0
    this.statusText = ''
    this.response = null
    this.responseText = ''
    this.responseType = ''
    this.responseURL = ''
    this.timeout = 0
    this.onreadystatechange = null
    this.onloadstart = null
    this.onprogress = null
    this.onload = null
    this.onerror = null
    this.onabort = null
    this.ontimeout = null
    this.onloadend = null
    this._listeners = {}
    this._inner = null
    this._url = ''
    this._method = 'GET'
    this._headers = {}
    this._respHeaders = null
    this._aborted = false
    this._done = false
    this._fallbackPending = false
  }

  GyXHR.prototype.addEventListener = function (type, handler) {
    if (!handler) return
    if (!this._listeners[type]) this._listeners[type] = []
    this._listeners[type].push(handler)
  }

  GyXHR.prototype.removeEventListener = function (type, handler) {
    const list = this._listeners[type]
    if (!list) return
    this._listeners[type] = list.filter((item) => item !== handler)
  }

  GyXHR.prototype._emit = function (type) {
    const event = { type, target: this, currentTarget: this }
    const prop = this['on' + type]
    if (typeof prop === 'function') {
      try { prop.call(this, event) } catch (err) { /* 忽略回调异常 */ }
    }
    const list = this._listeners[type]
    if (list) list.forEach((handler) => { try { handler.call(this, event) } catch (err) {} })
  }

  GyXHR.prototype.open = function (method, url) {
    this._method = String(method || 'GET').toUpperCase()
    this._url = String(url)
    this.readyState = 1
    this._emit('readystatechange')
  }

  GyXHR.prototype.setRequestHeader = function (name, value) {
    this._headers[name] = value
  }

  GyXHR.prototype.getResponseHeader = function (name) {
    const headers = this._respHeaders || {}
    const lower = String(name).toLowerCase()
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) return headers[key]
    }
    return null
  }

  GyXHR.prototype.getAllResponseHeaders = function () {
    if (this._inner && !this._native) {
      try { return this._inner.getAllResponseHeaders() || '' } catch (err) { return '' }
    }
    const headers = this._respHeaders || {}
    return Object.keys(headers).map((key) => `${key}: ${headers[key]}`).join('\r\n')
  }

  GyXHR.prototype.abort = function () {
    this._aborted = true
    this.readyState = 0
    try { if (this._inner) this._inner.abort() } catch (err) {}
    if (!this._done) {
      this._done = true
      this._emit('abort')
      this._emit('loadend')
    }
  }

  GyXHR.prototype._fallback = function (reason) {
    if (this._done || this._aborted || !this._url || this._fallbackPending) return
    this._fallbackPending = true
    this._native = true
    const rt = this.responseType === 'arraybuffer' || this.responseType === 'blob' ? 'arraybuffer' : 'text'
    const payload = {
      url: this._url,
      method: this._method,
      headers: this._headers,
      responseType: rt
    }
    let timer = null
    const timeoutMs = Number(this.timeout) > 0 ? Number(this.timeout) : 20000
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs)
    })
    Promise.race([
      window.Capacitor.nativePromise('CapacitorHttp', 'request', payload),
      timeout
    ])
      .then((res) => {
        clearTimeout(timer)
        if (this._aborted || this._done) return
        if (!res || res.__timeout) {
          this._fail('timeout')
          return
        }
        let data = res.data
        if (rt === 'arraybuffer') {
          data = typeof data === 'string' ? base64ToArrayBuffer(data) : null
        }
        if (rt === 'arraybuffer' && !data) {
          this._fail('binary')
          return
        }
        this.status = Number(res.status) || 0
        this.response = data
        this.responseText = typeof data === 'string' ? data : ''
        this.responseURL = res.url || this._url
        this._respHeaders = res.headers || null
        this.readyState = 4
        this._done = true
        this._emit('readystatechange')
        this._emit('load')
        this._emit('loadend')
      })
      .catch((err) => {
        clearTimeout(timer)
        if (this._aborted || this._done) return
        this._fail(err && err.message ? err.message : (reason || 'native-error'))
      })
  }

  GyXHR.prototype._fail = function (reason) {
    this.status = 0
    this.response = null
    this.responseText = ''
    this.readyState = 4
    this._done = true
    this._errReason = reason
    this._emit('readystatechange')
    this._emit('error')
    this._emit('loadend')
  }

  GyXHR.prototype.send = function (body) {
    const self = this
    try {
      const xhr = new NativeXHR()
      this._inner = xhr
      xhr.open(this._method, this._url, true)
      if (this.responseType) {
        try { xhr.responseType = this.responseType } catch (err) {}
      }
      if (Number(this.timeout) > 0) xhr.timeout = Number(this.timeout)
      for (const key of Object.keys(this._headers)) {
        try { xhr.setRequestHeader(key, this._headers[key]) } catch (err) {}
      }
      xhr.onreadystatechange = () => {
        if (self._aborted || self._done) return
        // CORS/混合内容被浏览器拦截时也会先给 readyState=4、status=0，不能当作成功
        if (xhr.readyState === 4 && xhr.status === 0) {
          self._fallback('status-0')
          return
        }
        // Chromium 在 readyState=4 的 readystatechange 回调里 response 仍是 null，
        // 不能在此时抛给 hls.js；等 onload 拿到完整数据后再补发一次 readyState=4 事件。
        if (xhr.readyState === 4) return
        self.readyState = xhr.readyState
        if (xhr.readyState >= 2) self.status = xhr.status
        self._emit('readystatechange')
      }
      xhr.onprogress = (event) => {
        if (self._aborted || self._done) return
        if (typeof self.onprogress === 'function') self.onprogress.call(self, event)
      }
      xhr.onload = () => {
        if (self._aborted || self._done) return
        self.status = xhr.status
        self.responseURL = xhr.responseURL || self._url
        try {
          self.response = xhr.response
        } catch (err) {
          self.response = null
        }
        self.responseText = ''
        // responseType=arraybuffer 时读取 responseText 会抛 InvalidStateError，必须单独处理
        try {
          if (typeof xhr.responseText === 'string') self.responseText = xhr.responseText
        } catch (err) {}
        try {
          self._respHeaders = parseHeaderText(xhr.getAllResponseHeaders())
        } catch (err) {
          self._respHeaders = null
        }
        self.readyState = 4
        self._done = true
        self._emit('readystatechange')
        self._emit('load')
        self._emit('loadend')
      }
      xhr.onerror = () => {
        if (self._aborted || self._done) return
        // CORS、混合内容、证书等浏览器层拦截：回退到原生请求
        self._fallback('browser-error')
      }
      xhr.ontimeout = () => {
        if (self._aborted || self._done) return
        self._fallback('browser-timeout')
      }
      xhr.onabort = () => {
        if (self._done || self._aborted) return
        self._fail('aborted')
      }
      xhr.send(body)
    } catch (err) {
      self._fallback('exception')
    }
  }

  function parseHeaderText(text) {
    const map = {}
    String(text || '')
      .split(/\r?\n/)
      .forEach((line) => {
        const idx = line.indexOf(':')
        if (idx > 0) map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      })
    return map
  }

  window.XMLHttpRequest = GyXHR
})()

/* 截帧封面：安卓 WebView 需要声明跨域才能用 canvas 读视频帧 */
window.extractThumb = function (url) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'
    video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:320px;height:180px'
    document.body.appendChild(video)
    let hls = null
    let done = false
    let timer = null
    const cleanup = () => {
      try {
        if (hls) hls.destroy()
      } catch {
        /* ignore */
      }
      hls = null
      video.removeAttribute('src')
      try {
        video.load()
      } catch {
        /* ignore */
      }
      video.remove()
    }
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      cleanup()
      resolve(result)
    }
    timer = setTimeout(() => finish(null), 15000)
    const draw = () => {
      try {
        const ratio = video.videoWidth ? video.videoHeight / video.videoWidth : 0.5625
        const canvas = document.createElement('canvas')
        canvas.width = 192
        canvas.height = Math.round(192 * ratio) || 108
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.65))
      } catch {
        finish(null)
      }
    }
    video.addEventListener('loadeddata', () => {
      if (done) return
      const duration = video.duration
      video.currentTime = Number.isFinite(duration) && duration > 4 ? Math.min(duration * 0.25, 90) : Math.min(3, duration || 3)
    })
    video.addEventListener('seeked', () => {
      if (!done) setTimeout(draw, 300)
    })
    video.addEventListener('error', () => finish(null))
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ maxBufferLength: 8, capLevelToPlayerSize: true })
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data && data.fatal) finish(null)
      })
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {})
      })
      hls.loadSource(url)
      hls.attachMedia(video)
    } else {
      video.src = url
      video.play().catch(() => {})
    }
  })
}

/* ---------- 打开软件时铺满整块屏幕 ----------
   部分车机/手机上应用会被放在较小的窗口里，这里启动后请求窗口撑满物理屏幕，
   并隐藏系统状态栏/导航栏，避免顶部和底部出现空白或内容被裁掉。 */
;(function () {
  const cap = window.Capacitor
  if (!cap || typeof cap.nativePromise !== 'function') return
  const call = (method, args) => cap.nativePromise('Immersive', method, args).catch(() => {})
  call('requestFullscreenWindow', {})
  call('setEnabled', { enabled: true })
})()

/* ---------- 顶栏搜索框 / 历史：收进抽屉，点顶栏按钮才展开 ----------
   手机上顶栏空间有限，搜索框和历史常驻会把导航挤到屏幕外，
   这里把它们移入抽屉默认隐藏，需要时点放大镜展开。 */
;(function () {
  const topbar = document.querySelector('.topbar')
  if (!topbar || topbar.dataset.gyDrawer === '1') return
  const search = topbar.querySelector('.search')
  const actions = topbar.querySelector('.topbar-actions')
  if (!search || !actions) return
  topbar.dataset.gyDrawer = '1'

  const drawer = document.createElement('div')
  drawer.className = 'gy-top-drawer'
  drawer.appendChild(search)
  drawer.appendChild(actions)
  topbar.appendChild(drawer)

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'gy-top-toggle'
  toggle.title = '搜索 / 历史'
  toggle.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>'
  const controls = topbar.querySelector('.win-controls')
  if (controls) topbar.insertBefore(toggle, controls)
  else topbar.appendChild(toggle)

  const setOpen = (open) => {
    topbar.classList.toggle('gy-top-open', open)
    if (open) {
      const input = drawer.querySelector('input')
      if (input) setTimeout(() => input.focus(), 60)
    }
  }

  toggle.addEventListener('click', (event) => {
    event.stopPropagation()
    setOpen(!topbar.classList.contains('gy-top-open'))
  })

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!topbar.classList.contains('gy-top-open')) return
      if (event.target.closest('.gy-top-drawer') || event.target.closest('.gy-top-toggle')) return
      setOpen(false)
    },
    true
  )

  drawer.addEventListener('click', (event) => {
    // 点了历史按钮/搜索结果后自动收起
    if (event.target.closest('.topbar-action')) setOpen(false)
  })
})()

/* 播放器关闭时同步退出全屏 */
document.addEventListener('click', (event) => {
  const btn = event.target.closest && event.target.closest('[data-action="player-close"], #playerBack')
  if (btn && document.fullscreenElement) document.exitFullscreen().catch(() => {})
})

/* ---------- 播放器触屏控制层（仅安卓） ----------
   点屏显示：左上返回、右上关闭、中央播放/暂停、底部进度条；
   进度条可点击/拖动定位；屏幕上向右滑快进、向左滑后退。 */
;(function () {
  const playerEl = document.getElementById('player')
  const videoEl = document.getElementById('video')
  if (!playerEl || !videoEl || !window.Capacitor) return
  if (playerEl.dataset.gyTouchUi === '1') return
  playerEl.dataset.gyTouchUi = '1'

  // 关掉 WebView 自带控件，避免与自定义控制层重叠、互相抢触摸事件
  videoEl.removeAttribute('controls')
  videoEl.controls = false

  const tools = playerEl.querySelector('.player-tools')
  const control = { hideTimer: 0, dragBar: null, gesture: null, lastHidden: playerEl.classList.contains('hidden') }

  // 右上角关闭
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'icon-btn gy-close'
  closeBtn.id = 'gyPlayerClose'
  closeBtn.title = '关闭'
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>'
  if (tools) tools.appendChild(closeBtn)
  else playerEl.appendChild(closeBtn)
  closeBtn.addEventListener('click', () => {
    if (typeof window.closePlayer === 'function') window.closePlayer()
  })

  // 音量控制（点击图标展开滑块）
  const VOL_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5l-5 4z" fill="currentColor" stroke="none" /><path d="M16.5 8.4c1.6 1.7 1.6 5.5 0 7.2" /></svg>'
  const VOL_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5l-5 4z" fill="currentColor" stroke="none" /><path d="m16 9 4 6M20 9l-4 6" /></svg>'
  const volBtn = document.createElement('button')
  volBtn.type = 'button'
  volBtn.className = 'icon-btn gy-vol'
  volBtn.id = 'gyPlayerVolume'
  volBtn.title = '音量'
  volBtn.innerHTML = VOL_ON
  if (tools) tools.insertBefore(volBtn, closeBtn)
  else playerEl.appendChild(volBtn)

  const volPop = document.createElement('div')
  volPop.className = 'gy-vol-pop'
  volPop.innerHTML =
    '<span class="gy-vol-label">音量</span>' +
    '<input class="gy-vol-range" type="range" min="0" max="1" step="0.01" aria-label="音量" />'
  playerEl.appendChild(volPop)
  const volRange = volPop.querySelector('.gy-vol-range')

  try {
    const savedRaw = localStorage.getItem('gyVideoVolume')
    if (savedRaw !== null) {
      const saved = Number(savedRaw)
      if (Number.isFinite(saved) && saved >= 0 && saved <= 1) videoEl.volume = saved
    }
  } catch (err) {}
  let volOpen = false

  function syncVolIcon() {
    volBtn.innerHTML = videoEl.volume > 0 ? VOL_ON : VOL_OFF
    volBtn.classList.toggle('muted', videoEl.volume === 0)
  }

  function setVolOpen(open) {
    volOpen = open
    volPop.classList.toggle('open', open)
  }

  volBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    if (!volOpen) volRange.value = String(videoEl.volume)
    setVolOpen(!volOpen)
    if (volOpen) showUi(false)
    else showUi()
  })

  volRange.addEventListener('pointerdown', (event) => event.stopPropagation())
  volRange.addEventListener('input', () => {
    const value = Math.max(0, Math.min(1, Number(volRange.value) || 0))
    videoEl.volume = value
    try {
      localStorage.setItem('gyVideoVolume', String(value))
    } catch (err) {}
    syncVolIcon()
  })
  volPop.addEventListener('pointerdown', (event) => event.stopPropagation())
  volRange.value = String(videoEl.volume)
  syncVolIcon()

  // 中央播放/暂停
  const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" /></svg>'
  const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 5v14M16.5 5v14" stroke-width="3" stroke-linecap="round" /></svg>'
  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.className = 'gy-play'
  playBtn.id = 'gyPlayerPlay'
  playBtn.title = '播放/暂停'
  playBtn.innerHTML = PLAY_ICON
  playerEl.appendChild(playBtn)
  playBtn.addEventListener('click', () => {
    if (videoEl.paused) videoEl.play().catch(() => {})
    else videoEl.pause()
  })

  // 底部进度条
  const bar = document.createElement('div')
  bar.className = 'gy-progress'
  bar.innerHTML =
    '<span class="gy-time gy-time-now">00:00</span>' +
    '<div class="gy-track"><div class="gy-fill"></div><div class="gy-knob"></div></div>' +
    '<span class="gy-time gy-time-all">00:00</span>'
  playerEl.appendChild(bar)
  const track = bar.querySelector('.gy-track')
  const fill = bar.querySelector('.gy-fill')
  const knob = bar.querySelector('.gy-knob')
  const timeNow = bar.querySelector('.gy-time-now')
  const timeAll = bar.querySelector('.gy-time-all')

  const hud = document.createElement('div')
  hud.className = 'gy-hud hidden'
  playerEl.appendChild(hud)

  // 透明手势层：位于视频之上、控制条之下
  const tap = document.createElement('div')
  tap.className = 'gy-tap'
  playerEl.insertBefore(tap, videoEl)

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '00:00'
    const total = Math.floor(sec)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    const mm = String(minutes).padStart(2, '0')
    const ss = String(seconds).padStart(2, '0')
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
  }

  function showUi(autoHide) {
    playerEl.classList.remove('idle')
    window.clearTimeout(control.hideTimer)
    control.hideTimer = 0
    if (autoHide === false || volOpen) return
    if (videoEl.paused) return
    control.hideTimer = window.setTimeout(() => {
      if (!videoEl.paused) playerEl.classList.add('idle')
    }, 5000)
  }

  function renderRatio(ratio, seconds) {
    const percent = `${ratio * 100}%`
    fill.style.width = percent
    knob.style.left = percent
    if (Number.isFinite(seconds)) timeNow.textContent = formatTime(seconds)
  }

  function isLiveMedia() {
    return !!(player.current && player.current.tvUrls) || videoEl.duration === Infinity
  }

  function updateBar() {
    const duration = videoEl.duration
    const live = isLiveMedia()
    bar.classList.toggle('is-live', live)
    if (live) {
      fill.style.width = '0%'
      knob.style.left = '0%'
      timeNow.textContent = '直播'
      timeAll.textContent = '直播'
      return
    }
    if (control.dragBar) {
      const ratio = control.dragBar.ratio
      renderRatio(ratio, Number.isFinite(duration) && duration > 0 ? ratio * duration : NaN)
      return
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      fill.style.width = '0%'
      knob.style.left = '0%'
      timeNow.textContent = '00:00'
      timeAll.textContent = '00:00'
      return
    }
    const ratio = Math.max(0, Math.min(1, videoEl.currentTime / duration))
    fill.style.width = `${ratio * 100}%`
    knob.style.left = `${ratio * 100}%`
    timeNow.textContent = formatTime(videoEl.currentTime)
    timeAll.textContent = formatTime(duration)
  }

  function syncPlayButton() {
    const paused = videoEl.paused
    playBtn.innerHTML = paused ? PLAY_ICON : PAUSE_ICON
    playBtn.classList.toggle('is-playing', !paused)
  }

  /* ---- 进度条拖动 ---- */
  function ratioFromEvent(event) {
    const rect = track.getBoundingClientRect()
    if (!rect.width) return 0
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  }

  function endBarDrag(event) {
    if (!control.dragBar || control.dragBar.id !== event.pointerId) return
    const ratio = control.dragBar.ratio
    control.dragBar = null
    const duration = videoEl.duration
    if (Number.isFinite(duration) && duration > 0) {
      videoEl.currentTime = Math.min(Math.max(0, duration - 0.05), ratio * duration)
    }
    updateBar()
    showUi()
  }

  track.addEventListener('pointerdown', (event) => {
    const duration = videoEl.duration
    if (isLiveMedia() || !Number.isFinite(duration) || duration <= 0) return
    event.preventDefault()
    event.stopPropagation()
    control.dragBar = { id: event.pointerId, ratio: ratioFromEvent(event) }
    try { track.setPointerCapture(event.pointerId) } catch (err) {}
    showUi(false)
    updateBar()
  })
  track.addEventListener('pointermove', (event) => {
    if (!control.dragBar || control.dragBar.id !== event.pointerId) return
    event.preventDefault()
    control.dragBar.ratio = ratioFromEvent(event)
    updateBar()
  })
  track.addEventListener('pointerup', endBarDrag)
  track.addEventListener('pointercancel', endBarDrag)

  /* ---- 点屏显示/隐藏 + 右滑快进 ---- */
  function seekSeconds(dx) {
    const raw = Math.round(dx / 10)
    if (Math.abs(raw) < 2) return 0
    return Math.max(-180, Math.min(180, raw))
  }

  function renderSeekPreview(seconds) {
    const duration = videoEl.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    const target = Math.max(0, Math.min(duration, videoEl.currentTime + seconds))
    renderRatio(target / duration, target)
  }

  tap.addEventListener('pointerdown', (event) => {
    if (typeof event.button === 'number' && event.button !== 0 && event.pointerType === 'mouse') return
    if (volOpen) {
      setVolOpen(false)
      control.gesture = null
      showUi()
      return
    }
    control.gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
      axis: ''
    }
    try { tap.setPointerCapture(event.pointerId) } catch (err) {}
  })

  tap.addEventListener('pointermove', (event) => {
    const gesture = control.gesture
    if (!gesture || gesture.id !== event.pointerId) return
    const dx = event.clientX - gesture.x
    const dy = event.clientY - gesture.y
    if (!gesture.axis && (Math.abs(dx) > 16 || Math.abs(dy) > 16)) {
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y'
    }
    if (gesture.axis !== 'x') return
    event.preventDefault()
    if (isLiveMedia()) return
    const seconds = seekSeconds(dx)
    if (!seconds) {
      hud.classList.add('hidden')
      return
    }
    hud.textContent = `${seconds > 0 ? '快进' : '后退'} ${formatTime(Math.abs(seconds))}`
    hud.classList.toggle('back', seconds < 0)
    hud.classList.remove('hidden')
    showUi(false)
    renderSeekPreview(seconds)
  })

  tap.addEventListener('pointerup', (event) => {
    const gesture = control.gesture
    if (!gesture || gesture.id !== event.pointerId) return
    control.gesture = null
    hud.classList.add('hidden')
    const dx = event.clientX - gesture.x
    const dy = event.clientY - gesture.y
    const elapsed = Date.now() - gesture.time
    if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && elapsed < 500) {
      // 点一下屏幕就显示控制条（不隐藏），松手后自动淡出
      showUi()
      return
    }
    if (gesture.axis === 'x' && Math.abs(dx) > 40 && !isLiveMedia()) {
      const seconds = seekSeconds(dx)
      const duration = videoEl.duration
      if (seconds && Number.isFinite(duration) && duration > 0) {
        videoEl.currentTime = Math.max(0, Math.min(duration, videoEl.currentTime + seconds))
      }
      updateBar()
      showUi()
      return
    }
    showUi()
  })

  tap.addEventListener('pointercancel', () => {
    control.gesture = null
    hud.classList.add('hidden')
    updateBar()
    showUi()
  })

  // 兜底：个别车机 WebView 的视频画面会吞掉手势层的点按事件，这里在播放器根节点补一次
  playerEl.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'mouse') return
    if (event.target.closest('button, .gy-progress, .gy-vol-pop, .gy-hud, .player-next')) return
    showUi()
  }, true)

  /* ---- 状态同步 ---- */
  // 触屏点击后 Chromium 会补发 mousemove，app.js 里桌面端的“移动鼠标显示控制条”
  // 会立刻把刚隐藏的控制条又显示出来；这里在捕获阶段拦掉触屏合成的鼠标移动事件。
  let lastTouchAt = 0
  playerEl.addEventListener('touchstart', () => { lastTouchAt = Date.now() }, true)
  playerEl.addEventListener('mousemove', (event) => {
    const synthetic = event.sourceCapabilities && event.sourceCapabilities.firesTouchEvents
    if (synthetic || Date.now() - lastTouchAt < 800) event.stopImmediatePropagation()
  }, true)

  videoEl.addEventListener('timeupdate', () => {
    if (!control.dragBar) updateBar()
  })
  videoEl.addEventListener('loadedmetadata', updateBar)
  videoEl.addEventListener('durationchange', updateBar)
  videoEl.addEventListener('play', () => {
    syncPlayButton()
    showUi()
  })
  videoEl.addEventListener('playing', syncPlayButton)
  videoEl.addEventListener('pause', () => {
    syncPlayButton()
    showUi(false)
  })

  const observer = new MutationObserver(() => {
    const hidden = playerEl.classList.contains('hidden')
    if (hidden === control.lastHidden) return
    control.lastHidden = hidden
    window.clearTimeout(control.hideTimer)
    control.hideTimer = 0
    if (!hidden) {
      updateBar()
      syncPlayButton()
      syncVolIcon()
      showUi(false)
    } else {
      setVolOpen(false)
    }
  })
  observer.observe(playerEl, { attributes: true, attributeFilter: ['class'] })
})()

/* 关闭按钮闲置 4 秒后自动淡出，轻触屏幕后重新出现 */
(function () {
  if (window.__gyCloseAutoHide) return
  window.__gyCloseAutoHide = true

  let timer = 0

  function show() {
    document.body.classList.remove('gy-ui-idle')
    window.clearTimeout(timer)
    timer = window.setTimeout(function () {
      document.body.classList.add('gy-ui-idle')
    }, 4000)
  }

  ;['touchstart', 'pointerdown', 'keydown', 'wheel'].forEach(function (ev) {
    window.addEventListener(ev, show, { passive: true })
  })

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) show()
  })

  show()
})()
