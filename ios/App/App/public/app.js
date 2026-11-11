/* 娟光阅影 - 渲染进程 */

const bridge = window.api

const contentEl = document.getElementById('content')
const detailEl = document.getElementById('detail')
const playerEl = document.getElementById('player')
const bookReaderEl = document.getElementById('bookReader')
const videoEl = document.getElementById('video')
const playerErrorEl = document.getElementById('playerError')
const playerNextEl = document.getElementById('playerNext')
const playerLoadingEl = document.getElementById('playerLoading')
const toastEl = document.getElementById('toast')
const searchInput = document.getElementById('searchInput')

const state = {
  settings: { folders: [], online: [], sources: [], prefs: { resume: true, autoplayNext: true } },
  info: {},
  library: { movies: [], series: [], errors: [], totalFiles: 0 },
  view: 'home',
  query: '',
  progress: {},
  scanning: false,
  watchables: new Map(),
  webMap: new Map(),
  webSearch: { query: '', searching: false, results: [] },
  categories: {},
  history: [],
  searches: [],
  qishuiWatch: null,
  qishuiLoginBound: false,
  movieGenre: 'hot',
  detail: null,
  sourcesCollapsed: false,
  books: { loading: false, loaded: false, results: [], search: '', error: '', category: 'all' },
  bookReader: null
}

const DEFAULT_SOURCES = [
  { name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod', enabled: true },
  { name: '非凡资源', api: 'https://api.ffzyapi.com/api.php/provide/vod', enabled: true },
  { name: '360资源', api: 'https://360zy.com/api.php/provide/vod', enabled: true },
  { name: '电影天堂', api: 'https://caiji.dyttzyapi.com/api.php/provide/vod', enabled: true },
  { name: '新浪资源', api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod', enabled: true },
  { name: '最大资源', api: 'https://api.zuidapi.com/api.php/provide/vod', enabled: true },
  { name: '无尽资源', api: 'https://api.wujinapi.com/api.php/provide/vod', enabled: true },
  { name: '光速资源', api: 'https://api.guangsuapi.com/api.php/provide/vod', enabled: true },
  { name: '友嗨影院', api: 'https://0av2wu.com', type: 'yh', enabled: true }
]

// 已失效的源，自动替换为可用源
const DEAD_SOURCE_APIS = ['https://cj.lziapi.com/api.php/provide/vod']

/* ---------- 友嗨影院接口（自带签名的私有接口） ---------- */

const YH_API_HOST = 'https://0av2wu.com'
const YH_SIGN_KEY = 'cb808529bae6b6be45ecfab29a4889bc'

function md5Hex(input) {
  const bytes = new TextEncoder().encode(String(input))
  const len = bytes.length
  const bitLen = len * 8
  const total = (((len + 8) >> 6) + 1) * 64
  const buffer = new Uint8Array(total)
  buffer.set(bytes)
  buffer[len] = 0x80
  const view = new DataView(buffer.buffer)
  view.setUint32(total - 8, bitLen >>> 0, true)
  view.setUint32(total - 4, Math.floor(bitLen / 4294967296), true)

  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < total; offset += 64) {
    const words = new Uint32Array(16)
    for (let j = 0; j < 16; j += 1) words[j] = view.getUint32(offset + j * 4, true)
    let A = a0
    let B = b0
    let C = c0
    let D = d0
    for (let i = 0; i < 64; i += 1) {
      let F
      let g
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      const rotate = shifts[(i >> 4) * 4 + (i % 4)]
      const sum = (F + A + K[i] + words[g]) >>> 0
      A = D
      D = C
      C = B
      B = (B + ((sum << rotate) | (sum >>> (32 - rotate)))) >>> 0
    }
    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }

  const leHex = (value) => {
    let out = ''
    for (let i = 0; i < 4; i += 1) out += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
    return out
  }
  return leHex(a0) + leHex(b0) + leHex(c0) + leHex(d0)
}

function sha1Hex(input) {
  const bytes = new TextEncoder().encode(String(input))
  const len = bytes.length
  const bitLen = len * 8
  const total = (((len + 8) >> 6) + 1) * 64
  const buffer = new Uint8Array(total)
  buffer.set(bytes)
  buffer[len] = 0x80
  const view = new DataView(buffer.buffer)
  view.setUint32(total - 8, Math.floor(bitLen / 4294967296))
  view.setUint32(total - 4, bitLen >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  for (let offset = 0; offset < total; offset += 64) {
    const w = new Uint32Array(80)
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 80; i += 1) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = (n << 1) | (n >>> 31)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i += 1) {
      let f
      let k
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = ((a << 5) | (a >>> 27)) + f + e + k + w[i]
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = temp >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  return [h0, h1, h2, h3, h4].map((value) => value.toString(16).padStart(8, '0')).join('')
}

function yhDeviceId() {
  try {
    const saved = localStorage.getItem('gyDeviceId')
    if (saved) return saved
  } catch {
    /* 忽略存储异常 */
  }
  const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = (Math.random() * 16) | 0
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
  try {
    localStorage.setItem('gyDeviceId', id)
  } catch {
    /* 忽略存储异常 */
  }
  return id
}

async function yhApi(path, params) {
  const time = Date.now()
  const keys = Object.keys(params).sort()
  const payload = keys.map((key) => `${key}=${params[key]}`).join('&')
  const sign = sha1Hex(md5Hex(`${payload}&key=${YH_SIGN_KEY}&t=${time}`))
  const query = keys.map((key) => `${key}=${encodeURIComponent(params[key])}`).join('&')
  const response = await fetch(`${YH_API_HOST}${path}?${query}`, {
    headers: {
      'client-type': '1',
      sign,
      t: String(time),
      deviceId: yhDeviceId(),
      authorization: ''
    }
  })
  const data = await response.json()
  if (!data || data.code !== 200 || !data.data) return null
  return data.data
}

async function yhSearch(query) {
  const data = await yhApi('/api/mw-movie/anonymous/video/searchByWord', {
    keyword: query,
    pageNum: 1,
    pageSize: 20
  })
  const list = (data && data.result && data.result.list) || []
  return list
    .map((vod) => ({
      key: `w:${YH_API_HOST}::${vod.vodId}`,
      title: String(vod.vodName || '').trim(),
      pic: /^https?:\/\//i.test(String(vod.vodPic || '')) ? String(vod.vodPic) : '',
      year: String(vod.vodYear || ''),
      type: String(vod.vodClass || '').split(',')[0] || '',
      remarks: String(vod.vodRemarks || ''),
      source: '友嗨影院',
      episodes: [],
      yh: true,
      vodId: vod.vodId
    }))
    .filter((item) => item.title)
}

async function yhEpisodes(vodId) {
  const data = await yhApi('/api/mw-movie/anonymous/video/detail', { id: vodId })
  const list = (data && data.episodeList) || []
  return list.map((episode) => {
    const name = String(episode.name || '').trim()
    return { name: /^\d+$/.test(name) ? `第 ${name} 集` : name, nid: episode.nid }
  })
}

async function yhEpisodeUrl(vodId, nid) {
  const data = await yhApi('/api/mw-movie/anonymous/v2/video/episode/url', {
    id: vodId,
    nid,
    clientType: 1
  })
  const list = (data && data.list) || []
  const pick =
    list.find((entry) => entry && entry.needLogin === false && entry.url) ||
    list.find((entry) => entry && entry.url)
  return pick ? String(pick.url) : ''
}

const player = {
  open: false,
  queue: [],
  index: 0,
  current: null,
  hls: null,
  objectUrl: null,
  hideTimer: null,
  saveAt: 0,
  resumePending: false,
  lastSeekAt: 0,
  seekStuckAt: 0,
  stallAt: 0,
  lastProgressTime: -1,
  liveRecoveries: 0
}

/* ---------- 内置网络片单 ---------- */

const BUILT_IN_ONLINE = [
  {
    id: 'b:bbb',
    title: '大雄兔',
    year: 2008,
    genre: '开源动画电影',
    desc: 'Blender 基金会开源动画短片，一只大雄兔对捣蛋啮齿动物的温柔复仇。',
    url: 'https://archive.org/download/BigBuckBunny_124/Content%2Fbig_buck_bunny_720p_surround.mp4'
  },
  {
    id: 'b:elephants',
    title: '小象的梦想',
    year: 2006,
    genre: '开源动画电影',
    desc: '世界上第一部开源电影，两个角色在奇异机械世界中的漫游。',
    url: 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4'
  },
  {
    id: 'b:sintel',
    title: '辛特尔',
    year: 2010,
    genre: '开源动画电影',
    desc: '少女独行者为寻回幼龙跨越千山万水的奇幻冒险。',
    url: 'https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4'
  },
  {
    id: 'b:cosmos',
    title: '宇宙洗衣店：第一循环',
    year: 2015,
    genre: '开源动画电影',
    desc: '荒岛上万念俱灰的绵羊，遇到了一只会说话的巨大蝴蝶。',
    url: 'https://archive.org/download/CosmosLaundromatFirstCycle/Cosmos%20Laundromat%20-%20First%20Cycle%20(1080p).mp4'
  },
  {
    id: 'b:tos',
    title: '钢铁之泪',
    year: 2012,
    genre: '开源科幻电影',
    desc: '未来阿姆斯特丹，一组科学家试图通过时间旅行拯救世界（含字幕）。',
    url: 'https://test-streams.mux.dev/tos_ismc/main.m3u8'
  },
  {
    id: 'b:hgf',
    title: '女友礼拜五',
    year: 1940,
    genre: '公版经典',
    desc: '霍华德·霍克斯执导的报馆快嘴喜剧，好莱坞黄金时代公版名片。',
    url: 'https://archive.org/download/his_girl_friday/his_girl_friday_512kb.mp4'
  },
  {
    id: 'b:shop',
    title: '恐怖小花',
    year: 1960,
    genre: '公版经典',
    desc: '罗杰·科曼的黑色幽默 cult 经典：一盆 hungry 的食人花。',
    url: 'https://archive.org/download/TheLittleShopOfHorrors/The%20Little%20Shop%20of%20Horrors.mp4'
  },
  {
    id: 'b:oceans',
    title: '海洋掠影',
    year: null,
    genre: '自然短片',
    desc: '蔚蓝海面下的自由遨游，治愈系自然短片。',
    url: 'https://vjs.zencdn.net/v/oceans.mp4'
  }
]

function isBuiltIn(id) {
  return String(id).startsWith('b:')
}

function allOnlineItems() {
  return [...BUILT_IN_ONLINE, ...(state.settings.online || [])]
}

/* 分类频道：按预设关键词从各搜索源聚合片源 */
const CATEGORY_VIEWS = {
  music: { title: '音乐厅', keywords: ['音乐', '演唱会'], desc: '音乐现场、演唱会与 MV 片段' },
  anime: { title: '动漫城', keywords: ['动漫', '动画'], desc: '热门动画片与动漫剧集' },
  novel: { title: '小说家', keywords: [], desc: '海量网络小说在线阅读', isBook: true },
  drama: { title: 'Ai短剧', keywords: ['短剧', '微短剧', '红果短剧', '抖音短剧', '快手短剧', '竖屏剧', '小剧场', '小说', '有声'], desc: '热门网络短剧、竖屏剧集与小说改编内容' }
}

function categorySlot(view) {
  if (!state.categories[view]) {
    state.categories[view] = {
      loading: false,
      loaded: false,
      results: [],
      page: 0,
      hasMore: true,
      sort: 'hot',
      search: '',
      musicSource: view === 'music' ? 'tt' : undefined
    }
  }
  return state.categories[view]
}

/* 网络动画片：按各片源自己的动漫分类 id 拉取，再用关键词补齐剧场版等条目 */
const ANIME_SOURCE_QUERIES = [
  { api: 'https://bfzyapi.com/api.php/provide/vod', queries: [{ t: 40 }, { t: 41 }, { t: 42 }] },
  { api: 'https://api.ffzyapi.com/api.php/provide/vod', queries: [{ t: 29 }, { t: 30 }, { t: 31 }] },
  { api: 'https://api.zuidapi.com/api.php/provide/vod', queries: [{ t: 29 }, { t: 30 }, { t: 31 }, { t: 44 }] },
  { api: 'https://api.wujinapi.com/api.php/provide/vod', queries: [{ t: 29 }, { t: 30 }, { t: 31 }, { t: 42 }] },
  { api: 'https://api.guangsuapi.com/api.php/provide/vod', queries: [{ t: 41 }, { t: 42 }, { t: 43 }, { t: 20 }] },
  { api: 'https://360zy.com/api.php/provide/vod', queries: [{ wd: '动漫' }] },
  { api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod', queries: [{ wd: '剧场版' }, { wd: '动漫' }] },
  { api: 'https://caiji.dyttzyapi.com/api.php/provide/vod', queries: [{ wd: '剧场版' }] }
]
const ANIME_MAX_PAGES = 30

function animeQueryPlan(sources) {
  const plan = []
  for (const source of sources) {
    const preset = ANIME_SOURCE_QUERIES.find((item) => item.api === source.api)
    if (preset) {
      for (const query of preset.queries) plan.push({ source, query })
    } else {
      plan.push({ source, query: { wd: '动漫' } })
    }
  }
  return plan
}

async function loadAnimePage(page) {
  const slot = categorySlot('anime')
  if (slot.loading) return
  if (page > ANIME_MAX_PAGES) {
    slot.hasMore = false
    if (state.view === 'anime' && !state.query) render()
    return
  }
  const sources = (state.settings.sources || []).filter((source) => source.enabled)
  if (!sources.length) {
    slot.loading = false
    slot.loaded = true
    slot.hasMore = false
    slot.error = '没有可用的搜索源，请到「设置」里启用或添加片源接口。'
    if (state.view === 'anime' && !state.query) render()
    return
  }
  slot.loading = true
  slot.error = ''
  if (state.view === 'anime' && !state.query) render()
  const keys = new Set(slot.results.map((item) => item.key))
  // 同名动漫在同一页只展示一条，但把其它片源的剧集挂成备用源，
  // 某个片源域名失效（证书过期 / 线路挂掉）时可以自动切换。
  const titleIndex = new Map(slot.results.map((item) => [`${item.title}|${item.year || ''}`, item]))
  let added = 0
  let pages = 0
  let failed = 0
  // 每个片源查询独立返回、先到先上屏，不再等最慢的接口
  const plan = animeQueryPlan(sources)
  const tasks = plan.map((item) =>
    fetchSourcePage(item.source, item.query, page)
      .then((response) => {
        pages = Math.max(pages, response.pagecount || 0)
        for (const entry of response.entries) {
          const dedupe = `${entry.title}|${entry.year || ''}`
          if (keys.has(entry.key)) continue
          const existing = titleIndex.get(dedupe)
          if (existing) {
            if (existing.source !== entry.source && entry.episodes && entry.episodes.length) {
              if (!existing.alts) existing.alts = []
              const hasAlt = existing.alts.some((alt) => alt.source === entry.source)
              if (!hasAlt) existing.alts.push({ source: entry.source, key: entry.key, episodes: entry.episodes })
            }
            continue
          }
          keys.add(entry.key)
          state.webMap.set(entry.key, entry)
          slot.results.push(entry)
          titleIndex.set(dedupe, entry)
          added += 1
        }
        if (added) scheduleCategoryRender('anime')
      })
      .catch(() => {
        failed += 1
      })
  )
  await Promise.allSettled(tasks)
  slot.page = page
  slot.loading = false
  slot.loaded = true
  slot.hasMore = page < Math.min(pages || ANIME_MAX_PAGES, ANIME_MAX_PAGES)
  if (!added && failed === plan.length) slot.hasMore = false
  if (!slot.results.length && failed === plan.length) {
    slot.error = '动漫片源接口暂时无法访问，请检查网络或稍后重试。'
  }
  if (state.view === 'anime' && !state.query) render()
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/* 片源逐个返回时合并渲染，120ms 内的多次更新只画一次，避免频繁重绘拖慢加载 */
let catRenderTimer = 0
let catRenderViews = null
function scheduleCategoryRender(...views) {
  if (!views.includes(state.view) || state.query) return
  catRenderViews = views
  if (catRenderTimer) return
  catRenderTimer = window.setTimeout(() => {
    catRenderTimer = 0
    const allowed = catRenderViews || []
    catRenderViews = null
    if (allowed.includes(state.view) && !state.query) render()
  }, 120)
}

async function loadCategory(view, searchQuery) {
  const conf = CATEGORY_VIEWS[view]
  if (!conf) return
  const slot = categorySlot(view)
  if (slot.loading) return
  if (view === 'anime') {
    if (!slot.loaded || !slot.results.length) loadAnimePage(1)
    return
  }
  const q = typeof searchQuery === 'string' ? searchQuery : slot.search || ''
  // 每日自动更新：若加载日期不是今天，则强制重新拉取
  const today = todayStr()
  if (slot.loaded && slot.search === q && slot.lastDate === today) return
  slot.loading = true
  slot.error = ''
  slot.search = q
  slot.results = []
  slot.lastDate = today
  if (state.view === view && !state.query) render()
  const cap = view === 'drama' ? Infinity : 60
  // 短剧先查最相关的 3 个关键词，一次并发 80+ 请求容易被源站限流导致全部失败
  const DRAMA_MAIN = ['短剧', '微短剧', '竖屏剧']
  const keywords = (
    q
      ? view === 'drama'
        ? [q, `${q} 短剧`]
        : [q, `${q} ${conf.keywords[0] || ''}`.trim()]
      : view === 'drama'
        ? DRAMA_MAIN
        : conf.keywords
  ).filter(Boolean)
  const extraKeywords = view === 'drama' && !q ? conf.keywords.filter((item) => !DRAMA_MAIN.includes(item)) : []
  const seenKeys = new Set()
  const sources = (state.settings.sources || []).filter((source) => source.enabled)
  if (!sources.length) {
    slot.loading = false
    slot.loaded = true
    if (state.view === view && !state.query) render()
    return
  }
  // 每个源 × 每个关键词 独立并发，随到随合并渲染，不等待慢源
  const runKeywords = async (list) => {
    const tasks = []
    for (const source of sources) {
      for (const keyword of list) {
        tasks.push(
          fetchSourcePage(source, { wd: keyword }, 1)
            .then(({ entries }) => {
              for (const entry of entries) {
                if (seenKeys.has(entry.key)) continue
                seenKeys.add(entry.key)
                // 卡片点击会通过 state.webMap 取回详情，这里必须同步写入，
                // 否则 AI 短剧/分类页点卡片没有任何反应。
                state.webMap.set(entry.key, entry)
                slot.results.push(entry)
                if (slot.results.length >= cap) break
              }
              if (state.view === view && !state.query) scheduleCategoryRender(view)
            })
            .catch(() => {})
        )
      }
    }
    await Promise.allSettled(tasks)
  }
  await runKeywords(keywords)
  // 主关键词一条都没拿到时，再补齐其余关键词
  if (extraKeywords.length && !slot.results.length) await runKeywords(extraKeywords)
  sortCategoryResults(slot)
  slot.loading = false
  slot.loaded = true
  if (state.view === view && !state.query) render()
}

/* 按 sort 字段排序分类结果：hot=热度降序，latest=更新时间降序 */
function sortCategoryResults(slot) {
  if (!slot.results.length) return
  slot.results.sort((a, b) => {
    if (slot.sort === 'latest') {
      const ta = Date.parse(a.updated || '') || 0
      const tb = Date.parse(b.updated || '') || 0
      return tb - ta
    }
    return (b.hot || 0) - (a.hot || 0)
  })
}

/* ---------- 小说家：书籍搜索与阅读（笔趣阁 biquge5200.cc） ---------- */

const BOOK_HOST = 'https://www.biquge5200.cc'
const BOOK_HOT = ['斗破苍穹', '完美世界', '遮天', '凡人修仙传', '诡秘之主', '赘婿', '庆余年', '剑来', '雪中悍刀行', '大奉打更人']

/* 小说分类（参考中图法分类，每类配搜索关键词） */
const NOVEL_CATEGORIES = [
  { id: 'all', name: '全部', keywords: BOOK_HOT },
  { id: 'literature', name: '文学', keywords: ['名著', '经典', '文学', '散文'] },
  { id: 'history', name: '历史、地理', keywords: ['历史', '三国', '明朝', '唐朝', '宋朝'] },
  { id: 'philosophy', name: '哲学', keywords: ['哲学', '思想', '人生', '智慧'] },
  { id: 'religion', name: '宗教', keywords: ['宗教', '佛', '道', '修仙', '修真'] },
  { id: 'art', name: '艺术', keywords: ['艺术', '音乐', '书法', '绘画'] },
  { id: 'culture', name: '文化、科学', keywords: ['文化', '科普', '知识', '百科'] },
  { id: 'social', name: '社会科学总论', keywords: ['社会', '心理', '教育', '职场'] },
  { id: 'politics', name: '政治、法律', keywords: ['政治', '官场', '法律', '权谋'] },
  { id: 'economy', name: '经济', keywords: ['经济', '商业', '创业', '金融'] },
  { id: 'language', name: '语言、文字', keywords: ['语言', '诗词', '文字', '写作'] },
  { id: 'military', name: '军事', keywords: ['军事', '战争', '特种兵', '抗战'] },
  { id: 'marxism', name: '马列毛邓理论', keywords: ['马克思', '列宁', '毛泽东', '邓小平'] },
  { id: 'naturalscience', name: '自然科学总论', keywords: ['科学', '自然', '探索', '发现'] },
  { id: 'math', name: '数理科学和化学', keywords: ['数学', '物理', '化学', '逻辑'] },
  { id: 'astronomy', name: '天文学、地球', keywords: ['天文', '宇宙', '地理', '地球'] },
  { id: 'biology', name: '生物科学', keywords: ['生物', '基因', '进化', '医学'] },
  { id: 'environment', name: '环境科学', keywords: ['环境', '生态', '末日', '废土'] },
  { id: 'medicine', name: '医药、卫生', keywords: ['医生', '医道', '药', '健康'] },
  { id: 'agriculture', name: '农业科学', keywords: ['农业', '种田', '农场', '乡村'] },
  { id: 'industry', name: '工业技术', keywords: ['工业', '科技', '机械', '制造'] },
  { id: 'transport', name: '交通运输', keywords: ['交通', '赛车', '航海', '驾驶'] },
  { id: 'aerospace', name: '航空、航天', keywords: ['航天', '星际', '太空', '科幻'] },
  { id: 'comprehensive', name: '综合性图书', keywords: ['全集', '合集', '大全', '杂谈'] }
]

async function fetchGbk(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  const buf = await res.arrayBuffer()
  return new TextDecoder('gbk').decode(buf)
}

function bookIdFromPath(path) {
  const m = String(path || '').match(/\/(\d+_\d+)\//)
  return m ? m[1] : ''
}

async function searchBooks(keyword) {
  const q = String(keyword || '').trim()
  if (!q) return []
  try {
    const html = await fetchGbk(`${BOOK_HOST}/modules/article/search.php?searchkey=${encodeURIComponent(q)}`)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const rows = doc.querySelectorAll('table.grid tr')
    const results = []
    for (const row of rows) {
      const cells = row.querySelectorAll('td')
      if (cells.length < 4) continue
      const nameLink = cells[0].querySelector('a')
      if (!nameLink) continue
      const bookPath = nameLink.getAttribute('href') || ''
      const bookId = bookIdFromPath(bookPath)
      if (!bookId) continue
      const title = nameLink.textContent.trim()
      const lastChapterLink = cells[1].querySelector('a')
      const lastChapter = lastChapterLink ? lastChapterLink.textContent.trim() : ''
      const author = cells[2].textContent.trim()
      const wordCount = cells[3].textContent.trim()
      const updateDate = cells.length > 4 ? cells[4].textContent.trim() : ''
      const status = cells.length > 5 ? cells[5].textContent.trim() : ''
      results.push({
        id: bookId,
        title,
        author,
        cover: '',
        shortIntro: '',
        lastChapter,
        cat: '',
        majorCate: '',
        wordCountText: wordCount,
        updateDate,
        status
      })
    }
    return results
  } catch {
    return []
  }
}

async function loadBookChapters(bookId) {
  try {
    const html = await fetchGbk(`${BOOK_HOST}/${bookId}/`)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const links = doc.querySelectorAll('#list dd a')
    const chapters = []
    for (const a of links) {
      const href = a.getAttribute('href') || ''
      const m = href.match(/\/(\d+_\d+)\/(\d+)\.html/)
      if (!m) continue
      chapters.push({
        index: chapters.length,
        title: a.textContent.trim(),
        link: `${m[1]}/${m[2]}`
      })
    }
    return chapters
  } catch {
    return []
  }
}

async function loadBookChapterContent(link) {
  try {
    const html = await fetchGbk(`${BOOK_HOST}/${link}.html`)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const contentEl = doc.getElementById('content')
    if (!contentEl) return ''
    contentEl.querySelectorAll('script, style').forEach((el) => el.remove())
    const paragraphs = Array.from(contentEl.querySelectorAll('p'))
    let text
    if (paragraphs.length) {
      text = paragraphs.map((p) => p.textContent.trim()).filter(Boolean).join('\n\n')
    } else {
      text = contentEl.textContent || ''
    }
    return text.replace(/笔趣阁[^\n]*$/gm, '').replace(/www\.biquge[^\n]*$/gim, '').trim()
  } catch {
    return ''
  }
}

async function loadNovel(searchQuery) {
  const slot = state.books
  if (slot.loading) return
  const q = typeof searchQuery === 'string' ? searchQuery : slot.search || ''
  const cat = NOVEL_CATEGORIES.find((c) => c.id === slot.category) || NOVEL_CATEGORIES[0]
  // 每日自动更新
  const today = todayStr()
  if (slot.loaded && slot.search === q && slot.lastDate === today && slot.results.length) return
  slot.loading = true
  slot.error = ''
  slot.search = q
  slot.results = []
  slot.lastDate = today
  if (state.view === 'novel' && !state.query) render()
  const keywords = q ? [q] : cat.keywords
  const seen = new Set()
  // 并发搜索所有关键词，随到随合并
  const tasks = keywords.map((kw) =>
    searchBooks(kw).then((books) => {
      for (const book of books) {
        if (seen.has(book.id)) continue
        seen.add(book.id)
        slot.results.push(book)
      }
      if (state.view === 'novel' && !state.query) render()
    })
  )
  await Promise.allSettled(tasks)
  slot.loading = false
  slot.loaded = true
  if (!slot.results.length) slot.error = q ? `没有找到与「${q}」相关的书籍` : `「${cat.name}」分类暂无书籍，试试搜索或切换其它分类`
  if (state.view === 'novel' && !state.query) render()
}

/* ---------- 网络电影：聚合采集站电影片源 ---------- */

const MOVIE_MENU = [
  { id: 'hot', label: '最热' },
  { id: 'new', label: '最新' },
  { id: 'all', label: '全部电影' },
  { id: 'action', label: '动作' },
  { id: 'hktw', label: '港台' },
  { id: 'mainland', label: '国内' },
  { id: 'costume', label: '古装' },
  { id: 'mystery', label: '悬疑' },
  { id: 'crime', label: '警匪' },
  { id: 'romance', label: '爱情' },
  { id: 'comedy', label: '喜剧' },
  { id: 'scifi', label: '科幻' },
  { id: 'horror', label: '鬼片' }
]

const MOVIE_SOURCE_MAP = {
  'https://bfzyapi.com/api.php/provide/vod': {
    all: [21, 22, 26],
    action: [21],
    comedy: [22],
    romance: [25],
    scifi: [24],
    horror: [23],
    extra: { costume: [{ wd: '古装' }, { wd: '武侠' }], mystery: [{ wd: '悬疑' }], crime: [{ wd: '警匪' }] },
    areas: { hktw: { types: [21, 22], areas: ['香港', '台湾'] }, mainland: { types: [21, 22], areas: ['大陆'] } }
  },
  'https://api.ffzyapi.com/api.php/provide/vod': {
    all: [6, 7, 11],
    action: [6],
    comedy: [7],
    romance: [8],
    scifi: [9],
    horror: [10],
    areas: { hktw: { types: [6, 7], areas: ['香港', '台湾'] }, mainland: { types: [6, 7], areas: ['大陆'] } }
  },
  'https://api.zuidapi.com/api.php/provide/vod': {
    all: [6, 7, 11],
    action: [6],
    comedy: [7],
    romance: [8],
    scifi: [9],
    horror: [10]
  },
  'https://api.wujinapi.com/api.php/provide/vod': {
    all: [6, 7, 11],
    action: [6],
    comedy: [7],
    romance: [8],
    scifi: [9],
    horror: [10],
    mystery: [32],
    crime: [34]
  },
  'https://api.guangsuapi.com/api.php/provide/vod': {
    all: [6, 7, 10],
    action: [6],
    comedy: [7],
    romance: [8],
    scifi: [9],
    horror: [11]
  },
  'https://360zy.com/api.php/provide/vod': {
    all: [6, 7, 11],
    action: [6],
    comedy: [7],
    romance: [8],
    scifi: [9],
    horror: [10],
    costume: [22, 23],
    mystery: [24],
    crime: [25]
  },
  'https://api.xinlangapi.com/xinlangapi.php/provide/vod': {
    all: [6, 10, 11],
    action: [6],
    comedy: [12],
    romance: [7],
    scifi: [8],
    horror: [11],
    mystery: [42],
    crime: [43]
  },
  'https://caiji.dyttzyapi.com/api.php/provide/vod': {
    all: [6, 7, 11],
    action: [6],
    comedy: [7],
    romance: [8],
    scifi: [9],
    horror: [10],
    areas: { hktw: { types: [6, 7], areas: ['香港', '台湾'] }, mainland: { types: [6, 7], areas: ['大陆'] } }
  }
}

const MOVIE_MAX_PAGES = 30
/* 只排除剧集与综艺等非电影类型，注意不能误伤「喜剧片」「剧情片」 */
const MOVIE_EXCLUDE_RE =
  /电视剧|连续剧|国产剧|香港剧|台湾剧|韩国剧|日本剧|欧美剧|海外剧|港台剧|短剧|微短剧|漫剧|综艺|动漫|动画|纪录|记录片|少儿|脱口秀|访谈|体育|新闻/i

function isMovieEntry(entry) {
  return !MOVIE_EXCLUDE_RE.test(String(entry.type || ''))
}

function movieSlot(genre) {
  const active = genre || state.movieGenre || 'hot'
  const key = ['hot', 'new', 'all'].includes(active) ? 'all' : active
  const slotKey = `movie:${key}`
  if (!state.categories[slotKey]) {
    state.categories[slotKey] = {
      loading: false,
      loaded: false,
      results: [],
      page: 0,
      hasMore: true,
      error: ''
    }
  }
  return state.categories[slotKey]
}

function movieQueryPlan(genre) {
  const plan = []
  const sources = (state.settings.sources || []).filter((source) => source.enabled)
  for (const source of sources) {
    const meta = MOVIE_SOURCE_MAP[source.api]
    if (!meta) continue
    if (genre === 'hktw' || genre === 'mainland') {
      const conf = meta.areas && meta.areas[genre]
      if (conf) {
        for (const area of conf.areas) {
          for (const t of conf.types) plan.push({ source, query: { t, area } })
        }
      }
      continue
    }
    const ids = genre === 'hot' || genre === 'new' || genre === 'all' ? meta.all : meta[genre]
    if (ids) for (const t of ids) plan.push({ source, query: { t } })
    const extra = meta.extra && meta.extra[genre]
    if (extra) for (const query of extra) plan.push({ source, query })
  }
  return plan
}

function movieSortedList(genre, slot) {
  const list = slot.results.slice()
  if (genre === 'hot') {
    return list.sort((a, b) => (b.hot || 0) - (a.hot || 0) || String(b.updated || '').localeCompare(String(a.updated || '')))
  }
  if (genre === 'new' || genre === 'all') {
    return list.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
  }
  return list
}

/* 影视列表本地缓存：启动时先用上次结果上屏，再后台刷新，保证 2 秒内有内容 */
const MOVIE_CACHE_PREFIX = 'gy_movie_'

function readMovieCache(genre) {
  try {
    const raw = localStorage.getItem(MOVIE_CACHE_PREFIX + genre)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.results) || !data.results.length) return null
    return data
  } catch {
    return null
  }
}

function writeMovieCache(genre, slot) {
  try {
    localStorage.setItem(
      MOVIE_CACHE_PREFIX + genre,
      JSON.stringify({ at: Date.now(), results: slot.results.slice(0, 60), hasMore: !!slot.hasMore })
    )
  } catch {
    /* 存储满了就放弃缓存 */
  }
}

async function loadMoviePage(page, genre) {
  const active = genre || state.movieGenre || 'hot'
  const slot = movieSlot(active)
  if (slot.loading) return
  // 首屏先用缓存渲染，避免启动时白屏等网络
  if (page === 1 && !slot.results.length) {
    const cached = readMovieCache(active)
    if (cached) {
      for (const entry of cached.results) {
        if (entry && entry.key && !state.webMap.has(entry.key)) state.webMap.set(entry.key, entry)
      }
      slot.results = cached.results.slice()
      slot.loaded = true
      slot.hasMore = !!cached.hasMore
    }
  }
  if (page > MOVIE_MAX_PAGES) {
    slot.hasMore = false
    if ((state.view === 'online' || state.view === 'home') && !state.query) render()
    return
  }
  const plan = movieQueryPlan(active)
  if (!plan.length) {
    slot.loaded = true
    slot.hasMore = false
    slot.error = '没有可用的电影片源，请到「设置」里启用或添加片源接口。'
    if ((state.view === 'online' || state.view === 'home') && !state.query) render()
    return
  }
  slot.loading = true
  slot.error = ''
  if ((state.view === 'online' || state.view === 'home') && !state.query) render()
  const keys = new Set(slot.results.map((item) => item.key))
  const titles = new Set(slot.results.map((item) => `${item.title}|${item.year || ''}`))
  let added = 0
  let pages = 0
  let failed = 0
  // 哪个源先返回就先上屏，不再等最慢的源
  const tasks = plan.map((item) =>
    fetchSourcePage(item.source, item.query, page)
      .then((response) => {
        pages = Math.max(pages, response.pagecount || 0)
        for (const entry of response.entries) {
          if (!isMovieEntry(entry)) continue
          const dedupe = `${entry.title}|${entry.year || ''}`
          if (keys.has(entry.key) || titles.has(dedupe)) continue
          keys.add(entry.key)
          titles.add(dedupe)
          state.webMap.set(entry.key, entry)
          slot.results.push(entry)
          added += 1
        }
        if (added) scheduleCategoryRender('online', 'home')
      })
      .catch(() => {
        failed += 1
      })
  )
  await Promise.allSettled(tasks)
  slot.page = page
  slot.loading = false
  slot.loaded = true
  slot.hasMore = page < Math.min(pages || MOVIE_MAX_PAGES, MOVIE_MAX_PAGES)
  if (!added) slot.hasMore = false
  if (added) writeMovieCache(active, slot)
  if (!slot.results.length && failed === plan.length) {
    // 全部源都失败：自动重试（最多 3 次），期间保持加载态，用户不需要手动点「重新加载」
    slot.loadRetry = (slot.loadRetry || 0) + 1
    if (slot.loadRetry <= 3) {
      slot.loaded = false
      window.setTimeout(() => {
        if (slot.results.length || slot.loading) return
        slot.error = ''
        loadMoviePage(1, active)
      }, 1000 * slot.loadRetry)
    } else {
      slot.error = '电影片源接口暂时无法访问，请检查网络或稍后重试。'
    }
  } else {
    slot.loadRetry = 0
  }
  if ((state.view === 'online' || state.view === 'home') && !state.query) render()
}

function ensureMovieLoaded() {
  const slot = movieSlot(state.movieGenre)
  if (!slot.loaded && !slot.loading) loadMoviePage(1, state.movieGenre)
}

function renderMovieLibrary() {
  const genre = state.movieGenre || 'hot'
  const slot = movieSlot(genre)
  const chips = MOVIE_MENU.map(
    (item) =>
      `<button class="music-chip cc-sort${item.id === genre ? ' active' : ''}" data-action="movie-genre" data-genre="${item.id}">${item.label}</button>`
  ).join('')
  let body = ''
  if (!slot.results.length && (slot.loading || !slot.loaded)) {
    body = `<div class="loading-note"><span class="spinner"></span>正在加载电影片源…</div>`
  } else if (!slot.results.length) {
    const tip = slot.error || '暂未找到相关影片，可重新加载或切换分类试试。'
    body = `<div class="folder-empty">${tip}<div class="anime-more"><button class="music-chip" data-action="movie-reload">重新加载</button></div></div>`
  } else {
    body = `<div class="grid">${movieSortedList(genre, slot).map(webCardHtml).join('')}</div>`
  }
  const more = slot.hasMore
    ? `<div class="anime-more"><button class="music-chip" data-action="movie-more">${
        slot.loading ? '正在加载…' : '加载更多'
      }</button></div>`
    : slot.results.length
      ? `<div class="anime-more">已加载全部 ${slot.results.length} 个片源</div>`
      : ''
  return `<section class="section">
      <div class="cc-sorts">${chips}</div>
      ${body}
      ${more}
    </section>`
}

/* 电视节目：CCTV 与各省卫视直播频道 */
// 随安装包内置的直播源：同源读取，不依赖任何 CDN，保证频道列表一定能显示
const TV_LOCAL_PLAYLIST = 'tv.m3u'

const TV_PLAYLISTS = [
  // 网络源只用于补充线路：同一份直播源走多个 CDN 镜像，谁先回来先合并谁
  'https://fastly.jsdelivr.net/gh/wwb521/live@main/tv.m3u',
  'https://cdn.jsdelivr.net/gh/wwb521/live@main/tv.m3u',
  'https://fastly.jsdelivr.net/gh/iptv-org/iptv@master/streams/cn.m3u',
  'https://cdn.jsdelivr.net/gh/iptv-org/iptv@master/streams/cn.m3u'
]

// 已确认无法稳定播放、需要从所有来源（含网络补充源）中剔除的频道
const TV_BLOCKED = new Set([
  '安徽卫视', '海峡卫视', '云南卫视', '大湾区卫视', '辽宁卫视', '吉林卫视',
  '东南卫视', '江西卫视', '河南卫视', '广东卫视', '深圳卫视', '海南卫视',
  '青海卫视', '甘肃卫视', '陕西卫视', '安多卫视', '新疆卫视',
  'CCTV5+', 'CCTV6', 'CCTV7', 'CCTV8', 'CCTV16', 'CCTV4K', 'CCTV8K'
])

const TV_PROVINCE_NAMES = {
  Anhui: '安徽卫视',
  Beijing: '北京卫视',
  Bingtuan: '兵团卫视',
  Chongqing: '重庆卫视',
  Fujian: '东南卫视',
  Gansu: '甘肃卫视',
  Guangdong: '广东卫视',
  Guangxi: '广西卫视',
  Guizhou: '贵州卫视',
  Hainan: '海南卫视',
  Hebei: '河北卫视',
  Heilongjiang: '黑龙江卫视',
  Henan: '河南卫视',
  Hubei: '湖北卫视',
  Hunan: '湖南卫视',
  'Inner Mongolia': '内蒙古卫视',
  'Nei Monggol': '内蒙古卫视',
  Jiangsu: '江苏卫视',
  Jiangxi: '江西卫视',
  Jilin: '吉林卫视',
  Liaoning: '辽宁卫视',
  Ningxia: '宁夏卫视',
  Qinghai: '青海卫视',
  Shaanxi: '陕西卫视',
  Shandong: '山东卫视',
  Shanghai: '东方卫视',
  Shanxi: '山西卫视',
  Shenzhen: '深圳卫视',
  Sichuan: '四川卫视',
  Tianjin: '天津卫视',
  Xizang: '西藏卫视',
  Xinjiang: '新疆卫视',
  Yanbian: '延边卫视',
  Yunnan: '云南卫视',
  Zhejiang: '浙江卫视'
}

const TV_PROVINCES = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江',
  '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆',
  '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'
]

const TV_CHANNEL_PROVINCE = {
  北京卫视: '北京',
  天津卫视: '天津',
  河北卫视: '河北',
  山西卫视: '山西',
  内蒙古卫视: '内蒙古',
  辽宁卫视: '辽宁',
  吉林卫视: '吉林',
  延边卫视: '吉林',
  黑龙江卫视: '黑龙江',
  东方卫视: '上海',
  江苏卫视: '江苏',
  浙江卫视: '浙江',
  安徽卫视: '安徽',
  东南卫视: '福建',
  海峡卫视: '福建',
  江西卫视: '江西',
  山东卫视: '山东',
  河南卫视: '河南',
  湖北卫视: '湖北',
  湖南卫视: '湖南',
  广东卫视: '广东',
  大湾区卫视: '广东',
  深圳卫视: '广东',
  广西卫视: '广西',
  海南卫视: '海南',
  重庆卫视: '重庆',
  四川卫视: '四川',
  康巴卫视: '四川',
  贵州卫视: '贵州',
  云南卫视: '云南',
  西藏卫视: '西藏',
  陕西卫视: '陕西',
  甘肃卫视: '甘肃',
  青海卫视: '青海',
  安多卫视: '青海',
  宁夏卫视: '宁夏',
  新疆卫视: '新疆',
  兵团卫视: '新疆'
}

function tvGroupRank(group) {
  if (group === '央视频道') return -1
  const index = TV_PROVINCES.indexOf(group)
  return index === -1 ? 99 : index
}

function tvSlot() {
  if (!state.tv) state.tv = { loading: false, loaded: false, channels: [], error: '' }
  return state.tv
}

function parseTvPlaylist(text) {
  const entries = []
  let pending = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF')) {
      const nameMatch = line.match(/,(.*)$/)
      const groupMatch = line.match(/group-title="([^"]*)"/)
      const name = nameMatch ? nameMatch[1].trim() : ''
      if (!name) {
        pending = null
        continue
      }
      pending = { name, group: (groupMatch ? groupMatch[1] : '').trim() }
      continue
    }
    if (line.startsWith('#')) continue
    if (!pending) continue
    const url = line.split('$LR')[0].trim()
    if (/^http/i.test(url)) entries.push({ name: pending.name, group: pending.group, url })
    pending = null
  }
  return entries
}

function normalizeTvEntry(entry) {
  // 去掉 4K/高清 等画质后缀，让「四川卫视4K」等归到普通省台，不再被丢弃
  const raw = String(entry.name || '').trim().replace(/\s*(4K|8K|超高清|高清|标清|HD)$/i, '').trim()
  const cctv = raw.match(/CCTV[-\s]?(\d+)(\+|K)?/i)
  if (/^央视频道$|^卫视频道$/.test(entry.group)) {
    if (cctv) return { name: `CCTV${cctv[1]}${cctv[2] ? cctv[2].toUpperCase() : ''}`, group: '央视频道' }
    return { name: raw, group: entry.group }
  }
  if (cctv) return { name: `CCTV${cctv[1]}${cctv[2] ? cctv[2].toUpperCase() : ''}`, group: '央视频道' }
  const satellite = raw.match(/^(.*?)\s*Satellite\s*TV/i)
  if (satellite) {
    const name = TV_PROVINCE_NAMES[satellite[1].trim()]
    if (name) return { name, group: '卫视频道' }
  }
  return null
}

function mergeTvChannels(entries, existing = []) {
  const map = new Map()
  // 已有频道直接放进结果：它们的 group 已经是省份，不能再走一遍解析（会被丢掉）
  for (const channel of existing) {
    if (!channel || !channel.name) continue
    if (TV_BLOCKED.has(channel.name)) continue
    map.set(channel.name, { name: channel.name, group: channel.group, urls: [...(channel.urls || [])] })
  }
  for (const entry of entries) {
    const normalized = normalizeTvEntry(entry)
    if (!normalized) continue
    const name = normalized.name
    if (TV_BLOCKED.has(name)) continue
    if (!/^CCTV\d{1,2}(?:\+|K)?$/.test(name) && !/^.+卫视$/.test(name)) continue
    let group = normalized.group
    if (group === '卫视频道') {
      group = TV_CHANNEL_PROVINCE[name] || ''
      if (!group) continue
    }
    if (!/^http/i.test(entry.url)) continue
    if (!map.has(name)) map.set(name, { name, group, urls: [] })
    const channel = map.get(name)
    if (!channel.urls.includes(entry.url) && channel.urls.length < 4) channel.urls.push(entry.url)
  }
  return [...map.values()]
    .filter((channel) => channel.urls.length)
    .sort((a, b) => {
      if (a.group !== b.group) return tvGroupRank(a.group) - tvGroupRank(b.group)
      const an = a.name.match(/^CCTV(\d+)/)
      const bn = b.name.match(/^CCTV(\d+)/)
      if (an && bn) return Number(an[1]) - Number(bn[1]) || a.name.localeCompare(b.name)
      if (an) return -1
      if (bn) return 1
      return 0
    })
}

const TV_CACHE_KEY = 'gyTvAliveCache'

function readTvCache() {
  try {
    return JSON.parse(localStorage.getItem(TV_CACHE_KEY) || '{}')
  } catch (err) {
    return {}
  }
}

function writeTvCache(cache) {
  try {
    localStorage.setItem(TV_CACHE_KEY, JSON.stringify(cache))
  } catch (err) {
    /* 忽略存储异常 */
  }
}

/* 谁先返回非空内容用谁；某个请求失败/为空不影响其他请求 */
function firstNonEmpty(promises) {
  return new Promise((resolve) => {
    let pending = promises.length
    if (!pending) {
      resolve('')
      return
    }
    for (const task of promises) {
      Promise.resolve(task)
        .then((text) => {
          if (text) resolve(text)
        })
        .catch(() => {})
        .then(() => {
          pending -= 1
          if (!pending) resolve('')
        })
    }
  })
}

async function tvFetchText(url, timeout) {
  const wait = timeout || 6000
  const webFetch = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), wait)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) return ''
      return await response.text()
    } catch (err) {
      return ''
    } finally {
      clearTimeout(timer)
    }
  }
  // 内置的 tv.m3u 是相对路径，只能走 WebView 同源读取
  if (!/^https?:/i.test(url)) return webFetch()
  // 安卓端原生 HTTP 与普通 fetch 同时请求，谁先拿到非空内容用谁
  if (bridge && typeof bridge.tvFetchText === 'function') {
    const raced = firstNonEmpty([bridge.tvFetchText({ url }), webFetch()])
    const guard = new Promise((resolve) => setTimeout(() => resolve(''), wait + 1500))
    return Promise.race([raced, guard])
  }
  return webFetch()
}

async function findWorkingTvUrl(urls) {
  // 同一频道的多条线路并行探测，按原顺序取第一条可用的，避免串行等待拖慢整页
  const probes = urls.map(async (url) => {
    if (bridge && typeof bridge.tvProbe === 'function') {
      try {
        return await bridge.tvProbe({ url })
      } catch (err) {
        return false
      }
    }
    const text = await tvFetchText(url, 2500)
    if (!text) return false
    if (/^#EXTM3U/i.test(text.trim())) return true
    return /\.m3u8/i.test(text)
  })
  const flags = await Promise.all(probes)
  let index = flags.findIndex(Boolean)
  if (index === -1 && urls.length) {
    // 直播源站对并发很敏感，偶发失败很常见：稍等后单独再试一次首选线路
    await new Promise((resolve) => setTimeout(resolve, 600))
    if (bridge && typeof bridge.tvProbe === 'function') {
      try {
        const retry = await bridge.tvProbe({ url: urls[0] })
        if (retry) index = 0
      } catch (err) {
        // 忽略重试异常
      }
    }
  }
  return index === -1 ? '' : urls[index]
}

async function validateTvChannels(channels) {
  const slot = tvSlot()
  const cache = readTvCache()
  const now = Date.now()
  slot.checking = true
  slot.checked = 0
  slot.total = channels.length
  if (state.view === 'tv') render()
  const results = new Array(channels.length)
  let cursor = 0
  const workers = Array.from({ length: 4 }, async (_, workerIndex) => {
    // 错开启动，避免 4 条通道同时打同一台源站被限流
    await new Promise((resolve) => setTimeout(resolve, workerIndex * 250))
    while (cursor < channels.length) {
      const index = cursor++
      const channel = channels[index]
      const cached = cache[channel.name]
      const cachedUrl = cached && now - cached.at < 6 * 60 * 60 * 1000 && channel.urls.includes(cached.url) ? cached.url : ''
      if (cachedUrl) {
        results[index] = { ...channel, urls: [cachedUrl, ...channel.urls.filter((url) => url !== cachedUrl)], noLine: false }
      } else {
        const working = await findWorkingTvUrl(channel.urls.slice(0, 2))
        if (working) {
          cache[channel.name] = { url: working, at: now }
          results[index] = { ...channel, urls: [working, ...channel.urls.filter((url) => url !== working)], noLine: false }
        } else {
          // 一条线路都没探通：保留该频道，但标记为待验证，避免用户以为能播却一直转圈
          results[index] = { ...channel, noLine: true }
        }
      }
      slot.checked += 1
    }
  })
  await Promise.all(workers)
  writeTvCache(cache)
  // 保留全部频道，只把探测可用的线路排到第一位，避免探测失败把整页频道清空
  slot.channels = channels.map((channel, index) => results[index] || channel)
  slot.checking = false
  if (!slot.channels.length) slot.error = '频道线路暂时都不可用，请稍后重试。'
  if (state.view === 'tv') render()
}

/* 只有真正进入电视台页才做线路探测，启动预取时不发大量探测请求 */
function maybeValidateTv() {
  const slot = tvSlot()
  if (!slot.channels.length || slot.checking || slot.checkedOnce) return
  slot.checkedOnce = true
  validateTvChannels(slot.channels)
}

async function loadTv() {
  const slot = tvSlot()
  if (slot.loading || slot.loaded) return
  slot.loading = true
  slot.error = ''
  if (state.view === 'tv') render()
  try {
    // 1) 先读随包内置的直播源：同源读取几乎立即返回，保证频道列表先显示出来
    const localText = await tvFetchText(TV_LOCAL_PLAYLIST, 4000)
    const localChannels = parseTvPlaylist(localText || '')
    if (localChannels.length) {
      slot.channels = mergeTvChannels(localChannels, slot.channels || [])
      slot.loaded = true
      if (state.view === 'tv') render()
    }
    // 2) 网络镜像并行补充线路，回来后继续合并，不阻塞已经显示的列表
    const tasks = TV_PLAYLISTS.map((url) =>
      tvFetchText(url, 6000)
        .then((text) => {
          const channels = parseTvPlaylist(text || '')
          if (!channels.length) return 0
          slot.channels = mergeTvChannels(channels, slot.channels || [])
          slot.loaded = true
          scheduleCategoryRender('tv')
          return channels.length
        })
        .catch(() => 0)
    )
    // 最多等 9 秒，避免个别源挂住导致页面一直停在加载态
    const counts = await Promise.race([
      Promise.all(tasks),
      new Promise((resolve) => setTimeout(() => resolve([]), 9000))
    ])
    if (!slot.channels || !slot.channels.length) {
      // 内置源也失败（极少见）：自动重试，最多 3 次
      slot.loadRetry = (slot.loadRetry || 0) + 1
      if (slot.loadRetry <= 3) {
        slot.loaded = false
        window.setTimeout(() => {
          if ((slot.channels && slot.channels.length) || slot.loading) return
          slot.error = ''
          loadTv()
        }, 1500 * slot.loadRetry)
      } else {
        slot.error = '直播源暂时没有可用频道，请稍后重试。'
      }
    } else {
      slot.loadRetry = 0
      maybeValidateTv()
    }
    if (window.console && counts && !counts.length) console.warn('[tv] 网络直播源无返回，已使用内置列表')
  } catch (err) {
    slot.error = '电视直播源加载失败，请检查网络后重试。'
  }
  slot.loading = false
  if (state.view === 'tv') render()
}

function playTv(index) {
  const slot = tvSlot()
  if (!slot.channels.length) return
  const queue = slot.channels.map((channel, i) => ({
    id: `tv:${i}`,
    title: channel.name,
    label: '直播',
    meta: channel.group,
    src: channel.urls[0],
    tvUrls: channel.urls,
    file: null,
    subtitle: null
  }))
  openPlayer(queue, Math.min(Math.max(0, index), queue.length - 1))
}

function tvCardHtml(channel, index) {
  const state = channel.noLine
    ? '<span class="tv-state tv-state-warn"><i></i>线路待验证</span>'
    : '<span class="tv-state"><i></i>直播中</span>'
  return `<button class="tv-card${channel.noLine ? ' tv-card-warn' : ''}" data-action="tv-play" data-index="${index}" data-name="${escapeHtml(channel.name)}">
    <span class="tv-badge">${channel.group === '央视频道' ? 'CCTV' : '卫视'}</span>
    <span class="tv-name">${escapeHtml(channel.name)}</span>
    ${state}
  </button>`
}

function applyTvFilter() {
  const input = document.getElementById('tvFilter')
  if (!input) return
  const keyword = input.value.trim().toLowerCase()
  if (state.tv) state.tv.filter = input.value
  contentEl.querySelectorAll('.tv-toggle').forEach((toggle) => {
    const section = toggle.closest('section')
    if (!section) return
    const cards = section.querySelectorAll('.tv-card')
    let visible = 0
    cards.forEach((card) => {
      const name = (card.dataset.name || '').toLowerCase()
      const match = !keyword || name.includes(keyword)
      card.classList.toggle('tv-hidden', !match)
      if (match) visible += 1
    })
    const countEl = section.querySelector('.tv-count')
    if (countEl) {
      const total = Number(countEl.dataset.total) || cards.length
      countEl.textContent = keyword ? `${visible} / ${total} 个频道` : `${total} 个频道`
    }
    section.classList.toggle('tv-hidden', !!keyword && visible === 0)
  })
}

function renderTv() {
  const slot = tvSlot()
  let body = ''
  if (!slot.channels.length && slot.loading) {
    body = `<div class="loading-note"><span class="spinner"></span>正在加载电视台列表…</div>`
  } else if (!slot.channels.length && slot.error) {
    body = `<div class="folder-empty">${escapeHtml(slot.error)}<br /><button class="btn ghost" data-action="tv-reload">重新加载</button></div>`
  } else {
    const groupNames = [...new Set(slot.channels.map((channel) => channel.group))]
      .sort((a, b) => tvGroupRank(a) - tvGroupRank(b))
    const collapsed = slot.collapsed || {}
    const sections = groupNames.map((group) => {
      const title = group === '央视频道' ? '央视频道' : `${group}台`
      const items = slot.channels
        .map((channel, index) => ({ channel, index }))
        .filter(({ channel }) => channel.group === group)
      const cards = items.map(({ channel, index }) => tvCardHtml(channel, index)).join('')
      const isCollapsed = !!collapsed[group]
      return {
        group,
        html: `<section class="section">
          <div class="section-head">
            <h2>${escapeHtml(title)}</h2>
            <button class="tv-toggle" data-action="tv-toggle" data-group="${escapeHtml(group)}" title="展开或收起频道">
              <span class="tv-count" data-total="${items.length}">${items.length} 个频道</span>
              <svg class="tv-chev${isCollapsed ? '' : ' open'}" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
            </button>
          </div>
          ${isCollapsed ? '' : `<div class="tv-grid${slot.layout === 'list' ? ' tv-list' : ''}">${cards}</div>`}
        </section>`
      }
    })
    const cctv = sections.filter((item) => item.group === '央视频道').map((item) => item.html).join('')
    const provinces = sections.filter((item) => item.group !== '央视频道').map((item) => item.html).join('')
    body = cctv + (provinces
      ? `<div class="tv-provinces${slot.layout === 'list' ? ' tv-provinces-list' : ''}">${provinces}</div>`
      : '')
  }
  const filterBar = !slot.channels.length
    ? ''
    : `<div class="tv-filter">
        <label class="search tv-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input id="tvFilter" type="search" placeholder="搜索频道，例如 北京卫视、CCTV5" autocomplete="off" value="${escapeHtml(slot.filter || '')}" />
        </label>
        <span class="tv-filter-tip">共 ${slot.channels.length} 个频道</span>
        <button class="tv-site" data-action="cctv-site" title="打开央视网官网页">央视网直播</button>
        <button class="tv-layout" data-action="tv-layout" title="切换平铺/竖排显示">${slot.layout === 'list' ? '平铺显示' : '竖排显示'}</button>
      </div>`
  return `<section class="section">
      ${filterBar}
      ${body}
    </section>`
}

/* ---------- 工具 ---------- */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  })
}

function encodePath(filePath) {
  return `media://local/${encodeURIComponent(filePath)}`
}

/* 已成功显示过的封面：重渲染时直接标记 is-loaded，避免再淡入一次造成频闪 */
const gyLoadedCovers = new Set()

function coverImgHtml(src) {
  const url = String(src || '')
  if (!url) return ''
  const loaded = gyLoadedCovers.has(url) ? ' class="is-loaded"' : ''
  return `<img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"${loaded} />`
}

function gradientFor(text) {
  let hue = 0
  const value = String(text || '')
  for (let i = 0; i < value.length; i += 1) hue = (hue * 31 + value.codePointAt(i)) % 360
  const second = (hue + 52) % 360
  return `background-image:linear-gradient(150deg,hsl(${hue} 42% 27%),hsl(${second} 48% 12%))`
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function formatSize(bytes) {
  if (!bytes) return ''
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`
}

function pad2(number) {
  return String(number).padStart(2, '0')
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem('guangying.progress') || '{}')
  } catch {
    return {}
  }
}

function saveProgress() {
  try {
    localStorage.setItem('guangying.progress', JSON.stringify(state.progress))
  } catch {
    /* 忽略存储失败 */
  }
}

function progressPercent(id) {
  const entry = state.progress[id]
  if (!entry || !entry.duration) return 0
  return Math.min(100, Math.max(0, (entry.seconds / entry.duration) * 100))
}

/* ---------- 历史记录 ---------- */

const HISTORY_LIMIT = 120
const SEARCH_LIMIT = 60

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem('gyPlayHistory') || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory() {
  try {
    localStorage.setItem('gyPlayHistory', JSON.stringify(state.history.slice(0, HISTORY_LIMIT)))
  } catch {
    /* 忽略存储失败 */
  }
}

function loadSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem('gySearchHistory') || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveSearches() {
  try {
    localStorage.setItem('gySearchHistory', JSON.stringify(state.searches.slice(0, SEARCH_LIMIT)))
  } catch {
    /* 忽略存储失败 */
  }
}

function timeAgo(timestamp) {
  const diff = Date.now() - (timestamp || 0)
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 86400000 * 30) return `${Math.floor(diff / 86400000)} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

function recordPlay(item) {
  if (!player.open || !item || !item.id) return
  if (item.src && item.src.startsWith('blob:')) return
  const known = state.watchables.get(item.id)
  const entry = {
    id: item.id,
    title: item.title || '未命名',
    label: item.label || '',
    meta: item.meta || '',
    at: Date.now(),
    poster: known && known.poster ? known.poster : '',
    posterUrl: (known && known.posterUrl) || item.posterUrl || '',
    thumb: item.file ? '' : item.src || '',
    url: item.file ? '' : item.src || ''
  }
  state.history = [entry, ...state.history.filter((record) => record.id !== entry.id)].slice(0, HISTORY_LIMIT)
  saveHistory()
}

function recordSearch(query) {
  const value = String(query || '').trim()
  if (value.length < 2) return
  const existing = state.searches.find((record) => record.q === value)
  const entry = { q: value, at: Date.now(), times: (existing?.times || 0) + 1 }
  state.searches = [entry, ...state.searches.filter((record) => record.q !== value)].slice(0, SEARCH_LIMIT)
  saveSearches()
}

function historyItem(entry) {
  return {
    id: entry.id,
    title: entry.title,
    meta: [entry.label, entry.meta].filter(Boolean).join(' · ') + ` · ${timeAgo(entry.at)}`,
    poster: entry.poster || '',
    posterUrl: entry.posterUrl || '',
    thumbSrc: entry.thumb || ''
  }
}

function playHistoryEntry(entry) {
  if (!entry) return
  if (String(entry.id).startsWith('w:')) {
    const raw = String(entry.id)
    const split = raw.lastIndexOf(':')
    const key = raw.slice(0, split)
    const idx = Number(raw.slice(split + 1)) || 0
    let webItem = state.webMap.get(key)
    if (!webItem && key.startsWith(`w:${YH_API_HOST}::`)) {
      webItem = {
        key,
        title: entry.title,
        pic: entry.posterUrl || '',
        source: '友嗨影院',
        episodes: [],
        yh: true,
        vodId: Number(key.split('::')[1])
      }
    }
    if (webItem) {
      playWeb(webItem, idx)
      return
    }
  }
  if (entry.url) {
    const known = state.watchables.get(entry.id)
    if (known && known.kind === 'online') {
      playById(entry.id)
      return
    }
    openPlayer(
      [
        {
          id: entry.id,
          title: entry.title,
          label: entry.label,
          meta: entry.meta,
          src: entry.url,
          file: null,
          subtitle: null
        }
      ],
      0
    )
    return
  }
  playById(entry.id)
}

let toastTimer = null
function toast(message) {
  toastEl.textContent = message
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200)
}

/* ---------- 片库模型 ---------- */

function rebuildWatchables() {
  const map = new Map()

  for (const movie of state.library.movies) {
    map.set(movie.id, {
      id: movie.id,
      kind: 'movie',
      title: movie.title,
      year: movie.year,
      poster: movie.poster,
      file: movie.file,
      subtitle: movie.subtitle,
      playable: movie.playable,
      meta: '电影'
    })
  }

  for (const series of state.library.series) {
    for (const episode of series.episodes) {
      map.set(episode.id, {
        id: episode.id,
        kind: 'episode',
        title: series.title,
        label: `第 ${episode.episode} 集`,
        poster: series.poster || episode.poster,
        file: episode.file,
        subtitle: episode.subtitle,
        playable: episode.playable,
        series,
        meta: '剧集'
      })
    }
  }

  for (const online of allOnlineItems()) {
    map.set(online.id, {
      id: online.id,
      kind: 'online',
      title: online.title,
      year: online.year || null,
      genre: online.genre || '',
      desc: online.desc || '',
      posterUrl: online.poster,
      url: online.url,
      builtIn: isBuiltIn(online.id),
      meta: online.genre || '在线'
    })
  }

  state.watchables = map
}

function continueList() {
  return [...state.watchables.values()]
    .map((item) => ({ item, entry: state.progress[item.id] }))
    .filter(({ entry }) => entry && entry.duration > 30 && entry.seconds > 5 && entry.seconds / entry.duration < 0.95)
    .sort((a, b) => (b.entry.at || 0) - (a.entry.at || 0))
    .slice(0, 12)
    .map(({ item }) => item)
}

/* ---------- 卡片 ---------- */

function cardHtml(item, options = {}) {
  const kind = options.kind || 'item'
  const play = options.play ? '1' : '0'
  const label = options.label || item.meta || ''
  const meta = [item.year ? String(item.year) : '', label].filter(Boolean).join(' · ')
  const percent = progressPercent(item.id)
  const gradient = gradientFor(item.title || '')
  const badge = options.badge ? `<span class="badge">${escapeHtml(options.badge)}</span>` : ''
  const posterSrc = item.poster ? encodePath(item.poster) : item.posterUrl || ''
  const thumbAttr = item.thumbSrc ? ` data-thumb="${escapeHtml(encodeURIComponent(item.thumbSrc))}"` : ''
  const actionAttr = options.action ? ` data-action="${escapeHtml(options.action)}"` : ''

  return `<article class="card" data-id="${escapeHtml(item.id)}" data-kind="${kind}" data-play="${play}"${thumbAttr}${actionAttr}>
    <div class="poster" style="${gradient}">
      ${posterSrc ? coverImgHtml(posterSrc) : ''}
      <div class="poster-fallback"><span>${escapeHtml((item.title || '?').trim().charAt(0))}</span></div>
      ${badge}
      ${percent > 0 && percent < 99 ? `<div class="progress"><i style="width:${percent.toFixed(1)}%"></i></div>` : ''}
    </div>
    <div class="card-title">${escapeHtml(item.title || '未命名')}</div>
    <div class="card-meta">${escapeHtml(meta)}</div>
  </article>`
}

function rowSection(title, cards, hint = '') {
  if (!cards) return ''
  return `<section class="section">
    <div class="section-head"><h2>${escapeHtml(title)}</h2>${hint ? `<span>${escapeHtml(hint)}</span>` : ''}</div>
    <div class="row">${cards}</div>
  </section>`
}

function gridSection(cards) {
  return `<div class="grid">${cards}</div>`
}

function emptyLibraryHtml() {
  return `<div class="empty">
    <div class="empty-mark">▶</div>
    <h2>开始建立你的片库</h2>
    <p>添加存放电影或剧集的文件夹，娟光阅影会自动整理影片、识别季集并生成海报墙；也可以直接观看内置的网络电影。</p>
    <div class="empty-actions">
      <button class="btn primary" data-action="add-folder">添加影片文件夹</button>
      <button class="btn ghost" data-action="goto-online">看网络电影</button>
    </div>
  </div>`
}

/* ---------- 首页 ---------- */

function homeCard(item) {
  if (item.key) return webCardHtml(item)
  return cardHtml({ ...item, meta: item.genre }, { kind: 'online', label: item.genre })
}

function homeFeed() {
  const slot = movieSlot('hot')
  let latest = []
  let hot = []
  if (slot.results.length) {
    latest = movieSortedList('new', slot).slice(0, 4)
    const latestKeys = new Set(latest.map((item) => item.key))
    hot = movieSortedList('hot', slot)
      .filter((item) => !latestKeys.has(item.key))
      .slice(0, 8)
  } else {
    latest = []
    hot = []
  }
  if (!slot.results.length && slot.loaded) {
    latest = BUILT_IN_ONLINE.slice(0, 4)
    hot = BUILT_IN_ONLINE.slice(0, 8)
  }
  return { slot, latest, hot }
}

function homeStageHtml() {
  const { slot, latest, hot } = homeFeed()
  const loading = slot.loading && !slot.results.length
  const latestCards = latest.length
    ? latest.map(homeCard).join('')
    : [0, 1, 2, 3].map(() => '<div class="home-skeleton"></div>').join('')
  const hotCards = hot.length
    ? hot.map(homeCard).join('')
    : [0, 1, 2, 3, 4, 5, 6, 7].map(() => '<div class="home-skeleton"></div>').join('')
  return `<section class="home-stage">
    <div class="home-stage-head">
      <span class="home-eyebrow">最新上映</span>
      <h1>今日新片</h1>
      <p>来自八个采集源，实时同步最新上线的电影${loading ? ' · 正在加载…' : ''}</p>
    </div>
    <div class="home-latest">${latestCards}</div>
    <div class="home-hot-head">
      <h2>最热电影</h2>
      <span>${slot.results.length ? `热度榜 · ${hot.length} 部` : '正在同步热度…'}</span>
    </div>
    <div class="home-hot">${hotCards}</div>
  </section>`
}

function renderHome() {
  const { movies, series } = state.library
  const online = state.settings.online || []
  if (!state.settings.folders.length && !online.length && !BUILT_IN_ONLINE.length) return emptyLibraryHtml()

  let html = homeStageHtml()

  if (state.scanning && !state.library.totalFiles) {
    html += `<div class="loading-note"><span class="spinner"></span>正在扫描影片…</div>`
  }

  const continuing = continueList()
  if (continuing.length) {
    html += rowSection(
      '继续观看',
      continuing
        .map((item) =>
          cardHtml(item, { kind: 'continue', play: true, label: [item.label, item.meta].filter(Boolean).join(' · ') })
        )
        .join('')
    )
  }

  const recent = [...movies, ...series].sort((a, b) => b.addedAt - a.addedAt).slice(0, 16)
  if (recent.length) {
    html += rowSection(
      '最近添加',
      recent
        .map((item) =>
          cardHtml(item, {
            kind: item.kind === 'series' ? 'series' : 'movie',
            label: item.kind === 'series' ? `${item.episodes.length} 集` : '电影'
          })
        )
        .join('')
    )
  }

  if (movies.length) {
    html += rowSection(
      '电影',
      movies
        .slice(0, 20)
        .map((item) => cardHtml(item, { kind: 'movie', label: '电影' }))
        .join(''),
      `${movies.length} 部`
    )
  }

  if (series.length) {
    html += rowSection(
      '剧集',
      series
        .slice(0, 20)
        .map((item) => cardHtml(item, { kind: 'series', label: `${item.episodes.length} 集` }))
        .join(''),
      `${series.length} 部`
    )
  }

  if (state.settings.folders.length && !movies.length && !series.length && !state.scanning) {
    html += `<div class="empty" style="min-height:auto;padding:60px 0">
      <h2>还没有找到可播放的视频</h2>
      <p>请确认文件夹中包含 mp4、webm、m4v、mov 等格式的视频文件，或换一个文件夹再试。</p>
    </div>`
  }

  return html
}

/* ---------- 列表页 ---------- */

function renderMovies() {
  if (!state.library.movies.length) {
    return `<div class="page-head"><h1>电影</h1><p>暂无电影</p></div>
      <div class="empty" style="min-height:46vh"><h2>没有找到电影</h2><p>添加包含影片的文件夹后，会自动识别成电影墙。</p>
      <div class="empty-actions"><button class="btn primary" data-action="add-folder">添加文件夹</button></div></div>`
  }
  const cards = state.library.movies.map((item) => cardHtml(item, { kind: 'movie', label: '电影' })).join('')
  return `<div class="page-head"><h1>电影</h1><p>共 ${state.library.movies.length} 部</p></div>${gridSection(cards)}`
}

function renderSeries() {
  if (!state.library.series.length) {
    return `<div class="page-head"><h1>剧集</h1><p>暂无剧集</p></div>
      <div class="empty" style="min-height:46vh"><h2>没有找到剧集</h2><p>文件名中包含 S01E01、第 1 集 等季集信息时，会自动归类为剧集。</p>
      <div class="empty-actions"><button class="btn primary" data-action="add-folder">添加文件夹</button></div></div>`
  }
  const cards = state.library.series
    .map((item) => cardHtml(item, { kind: 'series', label: `${item.episodes.length} 集` }))
    .join('')
  return `<div class="page-head"><h1>剧集</h1><p>共 ${state.library.series.length} 部</p></div>${gridSection(cards)}`
}

function renderOnline() {
  const manual = state.settings.online || []
  const builtCards = BUILT_IN_ONLINE.map((item) =>
    cardHtml({ ...item, meta: item.genre }, { kind: 'online', label: item.genre })
  ).join('')
  const manualCards = manual
    .map((item) => cardHtml(onlineCardItem({ ...item, meta: '在线' }), { kind: 'online', label: '在线' }))
    .join('')

  return `${renderMovieLibrary()}
    <section class="online-list">
      <div class="section-head"><h2>精选片单</h2><span>${BUILT_IN_ONLINE.length} 部 · 全部免费</span></div>
      ${gridSection(builtCards)}
    </section>
    <section class="online-list">
      <div class="section-head"><h2>我的在线链接</h2><span>${manual.length} 个</span></div>
      ${
        manual.length
          ? gridSection(manualCards)
          : `<div class="folder-empty">还没有自己的链接。有想看的 m3u8 / MP4 地址时，在下方添加即可。</div>`
      }
      <form id="onlineForm" class="panel online-form">
        <h2>添加播放链接</h2>
        <p class="hint">支持 HLS（.m3u8）与直链视频（.mp4 / .webm）。地址需以 http:// 或 https:// 开头。</p>
        <div class="form-grid">
          <input name="title" placeholder="名称" required maxlength="80" />
          <input name="url" placeholder="播放地址 https://…" required />
          <input name="poster" placeholder="封面图片地址（可选）" />
        </div>
        <button class="btn primary small" type="submit">添加到片单</button>
      </form>
    </section>`
}

/* ---------- 历史记录页 ---------- */

function renderHistory() {
  const records = state.history
  if (!records.length) {
    return `<div class="page-head"><h1>历史播放记录</h1><p>还没有播放记录</p></div>
      <div class="empty" style="min-height:46vh"><h2>看过的影片会出现在这里</h2><p>播放本地影片、网络电影或搜索到的剧集后，会自动记录在这里，点一下就能接着看。</p></div>`
  }
  const cards = records
    .map((entry) => cardHtml(historyItem(entry), { kind: 'history', play: true, action: 'play-history' }))
    .join('')
  return `<div class="page-head flex-head">
      <div><h1>历史播放记录</h1><p>共 ${records.length} 条 · 按最近播放排序，点击可继续播放</p></div>
      <button class="btn ghost small" data-action="clear-history">清空记录</button>
    </div>${gridSection(cards)}`
}

function renderSearches() {
  const records = state.searches
  if (!records.length) {
    return `<div class="page-head"><h1>历史搜索记录</h1><p>还没有搜索记录</p></div>
      <div class="empty" style="min-height:46vh"><h2>搜索过的片名会出现在这里</h2><p>在顶部搜索栏输入电影或剧集名称后，会自动记录，方便下次快速再搜。</p></div>`
  }
  const rows = records
    .map(
      (entry) => `<div class="history-row">
        <button class="history-query" data-action="use-search" data-query="${escapeHtml(entry.q)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m19.5 19.5-3.6-3.6" /></svg>
          <span class="history-text">${escapeHtml(entry.q)}</span>
        </button>
        <span class="history-time">${escapeHtml(timeAgo(entry.at))}</span>
        <button class="remove-folder" data-action="delete-search" data-query="${escapeHtml(entry.q)}">删除</button>
      </div>`
    )
    .join('')
  return `<div class="page-head flex-head">
      <div><h1>历史搜索记录</h1><p>共 ${records.length} 条 · 点击可重新搜索</p></div>
      <button class="btn ghost small" data-action="clear-searches">清空记录</button>
    </div>
    <div class="history-rows">${rows}</div>`
}

/* ---------- 设置 ---------- */

function renderSettings() {
  const folders = state.settings.folders || []
  const errors = state.library.errors || []
  const prefs = state.settings.prefs

  return `<div class="settings">
    <div class="page-head"><h1>设置</h1><p>管理影片目录与播放偏好</p></div>

    <section class="panel">
      <div class="panel-head">
        <div><h2>影片文件夹</h2><p class="hint">扫描时会自动识别电影、剧集和同名字幕、封面图片</p></div>
        <button class="btn ghost small" data-action="add-folder">添加文件夹</button>
      </div>
      ${
        folders.length
          ? `<div class="folder-list">${folders
              .map(
                (folder) => `<div class="folder-row">
                  <span class="folder-icon"><svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v10H3z"/></svg></span>
                  <span class="folder-path" title="${escapeHtml(folder)}">${escapeHtml(folder)}</span>
                  <button class="remove-folder" data-action="remove-folder" data-folder="${escapeHtml(folder)}">移除</button>
                </div>`
              )
              .join('')}</div>`
          : `<div class="folder-empty">尚未添加影片文件夹</div>`
      }
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn ghost small" data-action="rescan">${state.scanning ? '正在扫描…' : '重新扫描'}</button>
        <span class="hint" style="margin:0">已收录 ${state.library.totalFiles} 个视频文件</span>
      </div>
      ${
        errors.length
          ? `<div class="scan-errors">${errors
              .map((error) => `${escapeHtml(error.path || '')} ${escapeHtml(error.message || '读取失败')}`)
              .join('<br />')}</div>`
          : ''
      }
    </section>

    <section class="panel">
      <div class="panel-head">
        <div><h2>网络搜索源</h2><p class="hint">搜索影片名时，从启用的公开影视源聚合电影与剧集（苹果CMS V10 接口）</p></div>
        <div class="panel-head-actions">
          <button class="btn ghost small" data-action="toggle-sources" title="${state.sourcesCollapsed ? '展开' : '收起'}">${state.sourcesCollapsed ? '展开' : '收起'}</button>
          <button class="btn ghost small" data-action="reset-sources">恢复默认源</button>
        </div>
      </div>
      ${
        state.sourcesCollapsed
          ? ''
          : `${
              (state.settings.sources || []).length
                ? `<div class="folder-list">${state.settings.sources
                    .map(
                      (source, index) => `<div class="folder-row">
                        <input type="checkbox" data-source-toggle="${index}" ${source.enabled ? 'checked' : ''} title="启用/停用该源" />
                        <span class="folder-path" title="${escapeHtml(source.api)}">${escapeHtml(source.name)} · ${escapeHtml(source.api)}</span>
                        <button class="remove-folder" data-action="delete-source" data-idx="${index}">移除</button>
                      </div>`
                    )
                    .join('')}</div>`
                : `<div class="folder-empty">没有搜索源，可添加接口或点「恢复默认源」</div>`
            }
            <form id="sourceForm" class="online-form" style="margin-top:12px">
              <div class="form-grid">
                <input name="name" placeholder="源名称（如：某某资源站）" maxlength="30" required />
                <input name="api" placeholder="接口地址 https://…/api.php/provide/vod" required />
              </div>
              <button class="btn primary small" type="submit">添加搜索源</button>
            </form>`
      }
    </section>

    <section class="panel">
      <h2>播放偏好</h2>
      <p class="hint">更改后立即生效</p>
      <label class="switch-row">
        <span class="switch-copy"><strong>记住播放进度</strong><span>下次打开影片时从上次的位置继续播放</span></span>
        <input type="checkbox" data-pref="resume" ${prefs.resume ? 'checked' : ''} />
        <span class="switch"></span>
      </label>
      <label class="switch-row">
        <span class="switch-copy"><strong>自动播放下一集</strong><span>一集结束后自动接着播放下一集</span></span>
        <input type="checkbox" data-pref="autoplayNext" ${prefs.autoplayNext ? 'checked' : ''} />
        <span class="switch"></span>
      </label>
    </section>

    <section class="panel">
      <h2>关于娟光阅影</h2>
      <p class="hint">本地片库 + 在线播放，无广告、不收集任何数据</p>
      <div class="about-line">
        版本 ${escapeHtml(state.info.version || '1.0.0')} · Electron ${escapeHtml(state.info.electron || '')}<br />
        播放数据与设置仅保存在本机。
      </div>
    </section>
  </div>`
}

/* ---------- 搜索 ---------- */

function renderSearch() {
  const query = state.query.toLowerCase()
  const movies = state.library.movies.filter((item) => item.title.toLowerCase().includes(query))
  const series = state.library.series.filter((item) => item.title.toLowerCase().includes(query))
  const online = allOnlineItems().filter((item) => item.title.toLowerCase().includes(query))
  const webActive = state.webSearch.query === state.query
  const webResults = webActive ? state.webSearch.results : []
  const webSearching = webActive && state.webSearch.searching
  const localCount = movies.length + series.length + online.length
  const enabledCount = (state.settings.sources || []).filter((source) => source.enabled).length

  if (!localCount && !webSearching && !webResults.length) {
    return `<div class="page-head"><h1>搜索</h1><p>“${escapeHtml(state.query)}” 没有匹配结果</p></div>
      <div class="empty" style="min-height:46vh"><h2>没有找到相关内容</h2><p>可尝试更换关键词。全网搜索由公开影视源提供，若始终无结果，请在设置中检查或更换搜索源。</p></div>`
  }

  let html = `<div class="page-head"><h1>搜索结果</h1><p>“${escapeHtml(state.query)}” · 本地 ${localCount} 个 · 网络 ${
    webSearching ? '搜索中…' : `${webResults.length} 个`
  }</p></div>`

  if (localCount) {
    html += `<div class="grid">
      ${movies.map((item) => cardHtml(item, { kind: 'movie', label: '电影' })).join('')}
      ${series.map((item) => cardHtml(item, { kind: 'series', label: `${item.episodes.length} 集` })).join('')}
      ${online.map((item) => cardHtml(onlineCardItem({ ...item, meta: item.genre || '在线' }), { kind: 'online', label: item.genre || '在线' })).join('')}
    </div>`
  }

  html += `<section class="section">
    <div class="section-head"><h2>全网影视</h2><span>${
      webSearching ? '正在搜索…' : `${webResults.length} 个 · ${enabledCount} 个搜索源`
    }</span></div>`
  if (webSearching) {
    html += `<div class="loading-note"><span class="spinner"></span>正在搜索网络片源…</div>`
  } else if (webResults.length) {
    html += gridSection(
      webResults
        .map((item) => {
          const firstUrl = item.episodes.length ? item.episodes[0].url : ''
          return cardHtml(
            {
              id: item.key,
              title: item.title,
              posterUrl: pickWebPoster(item.pic, firstUrl),
              thumbSrc: firstUrl,
              year: item.year || null,
              meta: [item.year, item.type].filter(Boolean).join(' · ')
            },
            { kind: 'web', label: [item.remarks, item.source].filter(Boolean).join(' · ') || '网络' }
          )
        })
        .join('')
    )
  } else {
    html += `<div class="folder-empty">网络源未找到相关影片，可更换关键词，或在设置中添加更多搜索源。</div>`
  }
  html += `</section>`
  return html
}

/* ---------- 分类频道 ---------- */

function webCardHtml(item) {
  const firstUrl = item.episodes && item.episodes.length ? item.episodes[0].url : ''
  return cardHtml(
    {
      id: item.key,
      title: item.title,
      posterUrl: pickWebPoster(item.pic, firstUrl),
      thumbSrc: firstUrl,
      year: item.year || null,
      meta: [item.year, item.type].filter(Boolean).join(' · ')
    },
    { kind: 'web', label: [item.remarks, item.source].filter(Boolean).join(' · ') || '网络' }
  )
}

const MUSIC_TAGS = [
  { name: '全部', re: null },
  { name: '演唱会', re: /演唱会|巡演|liveshow/i },
  { name: '音乐现场', re: /现场|音乐节|live/i },
  { name: 'MV', re: /mv|单曲|歌曲|音乐/i }
]

function musicMatch(item, tag) {
  if (!tag || tag === '全部') return true
  const conf = MUSIC_TAGS.find((entry) => entry.name === tag)
  if (!conf || !conf.re) return true
  return conf.re.test(`${item.title} ${item.type || ''} ${item.remarks || ''}`)
}

function musicCardHtml(item) {
  const firstUrl = item.episodes && item.episodes.length ? item.episodes[0].url : ''
  const poster = pickWebPoster(item.pic, firstUrl)
  return `<button class="music-card" data-action="music-open" data-id="${escapeHtml(item.key)}">
    <span class="music-cover">
      ${poster ? coverImgHtml(poster) : '<span class="music-cover-fallback">♪</span>'}
      <span class="music-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" /></svg></span>
    </span>
    <span class="music-title">${escapeHtml(item.title)}</span>
    <span class="music-meta">${escapeHtml([item.remarks, item.type].filter(Boolean).join(' · ') || '网络音乐')}</span>
  </button>`
}

const CC_TAGS = [
  { name: '全部', re: null },
  { name: '电子', re: /electro|techno|house|drum|bass|dubstep|synth/i },
  { name: '摇滚', re: /rock|punk|metal|grunge/i },
  { name: '爵士', re: /jazz|blues|funk|soul/i },
  { name: '流行', re: /pop|vocal|song|ballad/i }
]

function ccTagMatch(item, tag) {
  if (!tag || tag === '全部') return true
  const conf = CC_TAGS.find((entry) => entry.name === tag)
  if (!conf || !conf.re) return true
  return conf.re.test(item.tags || '')
}

function ccSlot() {
  const slot = categorySlot('music')
  if (!slot.cc) slot.cc = { loading: false, loaded: false, results: [], offset: 0, error: '' }
  return slot.cc
}

async function loadCcMusic() {
  const cc = ccSlot()
  if (cc.loading) return
  if (!bridge || typeof bridge.ccMusic !== 'function') {
    cc.error = '当前版本不支持 CC 曲库'
    cc.loaded = true
    if (state.view === 'music') render()
    return
  }
  cc.loading = true
  cc.error = ''
  if (state.view === 'music') render()
  const data = await bridge.ccMusic(cc.offset)
  if (Array.isArray(data)) {
    for (const item of data) {
      const key = `w:cc::${item.id}`
      state.webMap.set(key, {
        key,
        title: item.title,
        pic: '',
        year: item.year,
        type: 'CC 音乐',
        remarks: [item.artist, item.license].filter(Boolean).join(' · '),
        source: 'CC 曲库',
        episodes: [{ name: '播放', url: item.url }]
      })
      if (!cc.results.some((seen) => seen.id === item.id)) cc.results.push(item)
    }
    cc.offset += 40
    cc.loaded = true
  } else {
    cc.error = (data && data.error) || '加载失败，请检查网络后重试'
  }
  cc.loading = false
  if (state.view === 'music') render()
}

const CC_SORTS = [
  { key: 'hot', label: '热门' },
  { key: 'artist', label: '按歌手' },
  { key: 'new', label: '最新' }
]

function ccCardHtml(item, showArtist = true) {
  const meta = [showArtist ? item.artist : '', item.license].filter(Boolean).join(' · ')
  return `<button class="music-card" data-action="music-open" data-id="w:cc::${escapeHtml(item.id)}">
    <span class="music-cover">
      <span class="music-cover-fallback">♪</span>
      ${item.duration ? `<span class="music-len">${escapeHtml(item.duration)}</span>` : ''}
      <span class="music-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" /></svg></span>
    </span>
    <span class="music-title">${escapeHtml(item.title)}</span>
    <span class="music-meta">${escapeHtml(meta)}</span>
  </button>`
}

function ccHotOf(item) {
  return Number(item.hot) || 0
}

function ccSortList(items, sort) {
  const list = [...items]
  if (sort === 'new') {
    list.sort((a, b) => String(b.year || '').localeCompare(String(a.year || '')))
  } else {
    list.sort((a, b) => ccHotOf(b) - ccHotOf(a))
  }
  return list
}

function ccArtistGroups(items) {
  const map = new Map()
  for (const item of items) {
    const name = String(item.artist || '匿名音乐人').trim() || '匿名音乐人'
    if (!map.has(name)) map.set(name, [])
    map.get(name).push(item)
  }
  return [...map.entries()]
    .map(([name, list]) => ({
      name,
      list: ccSortList(list, 'hot'),
      heat: list.reduce((sum, item) => sum + ccHotOf(item), 0)
    }))
    .sort((a, b) => b.heat - a.heat)
}

function renderCcMusic(slot) {
  const cc = slot.cc || { loading: false, loaded: false, results: [], error: '' }
  const tag = slot.ccTag || '全部'
  const sort = slot.ccSort || 'hot'
  const items = (cc.results || []).filter((item) => ccTagMatch(item, tag))
  const groups = sort === 'artist' ? ccArtistGroups(items) : []
  const status =
    cc.loading && !cc.results.length
      ? '正在加载…'
      : sort === 'artist'
        ? `${groups.length} 位歌手 · ${items.length} 首`
        : `${(cc.results || []).length} 首`
  let body = ''
  if (cc.loading && !cc.results.length) {
    body = '<div class="loading-note"><span class="spinner"></span>正在加载 CC 授权曲库…</div>'
  } else if (cc.error && !cc.results.length) {
    body = `<div class="folder-empty">${escapeHtml(cc.error)}，<button class="music-more" data-action="cc-more">重新加载</button></div>`
  } else if (!items.length) {
    body = '<div class="folder-empty">该分类下暂时没有曲目，换个分类试试。</div>'
  } else if (sort === 'artist') {
    body = `${groups
      .map(
        (group) => `<section class="cc-artist">
          <div class="cc-artist-head">
            <span class="cc-artist-avatar">${escapeHtml(group.name.slice(0, 1).toUpperCase())}</span>
            <span class="cc-artist-name">${escapeHtml(group.name)}</span>
            <span class="cc-artist-count">${group.list.length} 首</span>
          </div>
          <div class="music-grid">${group.list.map((item) => ccCardHtml(item, false)).join('')}</div>
        </section>`
      )
      .join('')}
      <div class="music-more-row">
        <button class="music-more" data-action="cc-more">${cc.loading ? '正在加载…' : '加载更多'}</button>
      </div>`
  } else {
    body = `<div class="music-grid">${ccSortList(items, sort).map((item) => ccCardHtml(item)).join('')}</div>
      <div class="music-more-row">
        <button class="music-more" data-action="cc-more">${cc.loading ? '正在加载…' : '加载更多'}</button>
      </div>`
  }
  return `<div class="music-chips">
      ${CC_TAGS.map(
        (entry) =>
          `<button class="music-chip${entry.name === tag ? ' active' : ''}" data-action="cc-tag" data-tag="${entry.name}">${entry.name}</button>`
      ).join('')}
      <span class="music-count">${status}</span>
    </div>
    <div class="cc-sorts">
      <span class="cc-sort-label">排列</span>
      ${CC_SORTS.map(
        (entry) =>
          `<button class="music-chip cc-sort${entry.key === sort ? ' active' : ''}" data-action="cc-sort" data-sort="${entry.key}">${entry.label}</button>`
      ).join('')}
    </div>${body}`
}

const KUGOU_STARS = [
  '周杰伦',
  '林俊杰',
  '邓紫棋',
  '薛之谦',
  '陈奕迅',
  '张杰',
  '张学友',
  '刘德华',
  '王菲',
  '毛不易',
  '许嵩',
  '汪苏泷',
  '李荣浩',
  '周深',
  '孙燕姿'
]

const OFFICIAL_PLATFORMS = {
  douyin: {
    title: '抖音音乐',
    placeholder: '输入抖音热歌、歌手或话题',
    defaults: ['抖音热歌', '热门翻唱', '说唱', '民谣', '古风'],
    tip: '抖音的音乐与视频版权仅限在抖音站内播放，点击按钮会在软件内打开抖音官方搜索窗口，登录后即可收听完整歌曲。'
  },
  kuaishou: {
    title: '快手音乐',
    placeholder: '输入歌手、歌曲或热门话题',
    defaults: ['热门音乐', '热门翻唱', 'DJ', '民谣', '喊麦'],
    tip: '快手音乐多为短视频配乐，点击按钮会在软件内打开快手官方搜索窗口，登录后即可收听。'
  },
  qishui: {
    title: '汽水音乐',
    placeholder: '输入歌手或歌曲',
    defaults: ['热歌榜', '抖音热歌', '华语流行', '粤语', '欧美'],
    tip: '汽水音乐是字节跳动旗下音乐 App，版权曲库仅限站内播放，点击按钮会打开汽水音乐官方窗口。'
  }
}

function kgSlot() {
  const slot = categorySlot('music')
  if (!slot.kg) {
    slot.kg = { loading: false, keyword: '周杰伦', list: [], total: 0, error: '', sort: 'hot' }
  }
  return slot.kg
}

function officialSlot(key) {
  const slot = categorySlot('music')
  if (!slot.official) slot.official = {}
  const conf = OFFICIAL_PLATFORMS[key]
  if (!slot.official[key]) slot.official[key] = { keyword: conf.defaults[0] }
  return slot.official[key]
}

function qqSlot() {
  const slot = categorySlot('music')
  if (!slot.qq) {
    slot.qq = { loading: false, keyword: '周杰伦', list: [], singers: [], error: '' }
  }
  return slot.qq
}

function fmtDuration(seconds) {
  const total = Number(seconds) || 0
  if (!total) return ''
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

async function loadKugou(keyword) {
  const kg = kgSlot()
  if (keyword != null) kg.keyword = String(keyword).trim()
  if (!kg.keyword) return
  if (!bridge || typeof bridge.kugouSearch !== 'function') {
    kg.error = '当前版本不支持酷狗曲库'
    if (state.view === 'music') render()
    return
  }
  kg.loading = true
  kg.error = ''
  if (state.view === 'music') render()
  const data = await bridge.kugouSearch({ keyword: kg.keyword, page: 1, pagesize: 30 })
  if (data && Array.isArray(data.list)) {
    kg.list = data.list
    kg.total = Number(data.total) || data.list.length
  } else {
    kg.error = (data && data.error) || '酷狗搜索失败，请检查网络后重试'
  }
  kg.loading = false
  if (state.view === 'music') render()
}

function kgRowHtml(item, index) {
  const hot = Number(item.hot) || 0
  const hotText = hot >= 10000 ? `${(hot / 10000).toFixed(1)} 万` : String(hot)
  return `<button class="kg-row" data-action="kg-open" data-hash="${escapeHtml(item.hash)}" data-album="${escapeHtml(item.albumId || '')}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist || '')}">
    <span class="kg-rank">${index + 1}</span>
    <span class="kg-cover">♪</span>
    <span class="kg-info">
      <span class="kg-name">${escapeHtml(item.title)}</span>
      <span class="kg-artist">${escapeHtml([item.artist, item.album].filter(Boolean).join(' · '))}</span>
    </span>
    <span class="kg-hot">${hot ? `收藏 ${hotText}` : ''}</span>
    <span class="kg-len">${fmtDuration(item.duration)}</span>
  </button>`
}

function renderKugou() {
  const kg = kgSlot()
  const sort = kg.sort || 'hot'
  const list = [...kg.list]
  if (sort === 'hot') list.sort((a, b) => (Number(b.hot) || 0) - (Number(a.hot) || 0))
  const search = `<form class="kg-search" id="kgForm">
      <input id="kgKeyword" type="search" placeholder="搜索歌手或歌曲，如：周杰伦" value="${escapeHtml(kg.keyword)}" />
      <button type="submit" class="music-more">搜索</button>
    </form>`
  const stars = `<div class="music-chips">
      ${KUGOU_STARS.map(
        (name) =>
          `<button class="music-chip${name === kg.keyword ? ' active' : ''}" data-action="kg-star" data-keyword="${name}">${name}</button>`
      ).join('')}
      <span class="music-count">${kg.total ? `${kg.total} 首` : ''}</span>
    </div>`
  const sorts = `<div class="cc-sorts">
      <span class="cc-sort-label">排列</span>
      <button class="music-chip cc-sort${sort === 'hot' ? ' active' : ''}" data-action="kg-sort" data-sort="hot">热门</button>
      <button class="music-chip cc-sort${sort === 'default' ? ' active' : ''}" data-action="kg-sort" data-sort="default">默认</button>
      <button class="music-chip cc-sort" data-action="music-login" data-platform="kugou">登录酷狗账号</button>
    </div>`
  let body = ''
  if (kg.loading) {
    body = '<div class="loading-note"><span class="spinner"></span>正在从酷狗检索…</div>'
  } else if (kg.error) {
    body = `<div class="folder-empty">${escapeHtml(kg.error)}，<button class="music-more" data-action="kg-star" data-keyword="${escapeHtml(kg.keyword)}">重试</button></div>`
  } else if (!list.length) {
    body = '<div class="folder-empty">没有找到歌曲，换个歌手名字试试。</div>'
  } else {
    body = `<div class="kg-list">${list.map(kgRowHtml).join('')}</div>
      <p class="kg-tip">点击歌曲会在软件内打开酷狗官方播放页，登录酷狗账号后可播放完整曲目；曲目版权归酷狗及版权方所有。</p>`
  }
  return `${search}${stars}${sorts}${body}`
}

async function loadQq(keyword) {
  const qq = qqSlot()
  if (keyword != null) qq.keyword = String(keyword).trim()
  if (!qq.keyword) return
  if (!bridge || typeof bridge.qqSearch !== 'function') {
    qq.error = '当前版本不支持 QQ 音乐搜索'
    if (state.view === 'music') render()
    return
  }
  qq.loading = true
  qq.error = ''
  if (state.view === 'music') render()
  const data = await bridge.qqSearch({ keyword: qq.keyword })
  if (data && Array.isArray(data.list)) {
    qq.list = data.list
    qq.singers = data.singers || []
  } else {
    qq.error = (data && data.error) || 'QQ 音乐搜索失败，请检查网络后重试'
  }
  qq.loading = false
  if (state.view === 'music') render()
}

function renderQq() {
  const qq = qqSlot()
  const search = `<form class="kg-search" id="qqForm">
      <input id="qqKeyword" type="search" placeholder="搜索歌手或歌曲，如：周杰伦" value="${escapeHtml(qq.keyword)}" />
      <button type="submit" class="music-more">搜索</button>
    </form>`
  const stars = `<div class="music-chips">
      ${KUGOU_STARS.slice(0, 10)
        .map(
          (name) =>
            `<button class="music-chip${name === qq.keyword ? ' active' : ''}" data-action="qq-star" data-keyword="${name}">${name}</button>`
        )
        .join('')}
      <span class="music-count">${qq.list.length ? `${qq.list.length} 首` : ''}</span>
      <button class="music-chip cc-sort" data-action="music-login" data-platform="qq">登录 QQ 音乐</button>
    </div>`
  let body = ''
  if (qq.loading) {
    body = '<div class="loading-note"><span class="spinner"></span>正在从 QQ 音乐检索…</div>'
  } else if (qq.error) {
    body = `<div class="folder-empty">${escapeHtml(qq.error)}，<button class="music-more" data-action="qq-star" data-keyword="${escapeHtml(qq.keyword)}">重试</button></div>`
  } else if (!qq.list.length) {
    body = '<div class="folder-empty">没有找到歌曲，换个歌手名字试试。</div>'
  } else {
    body = `<div class="kg-list">${qq.list
      .map(
        (item, index) => `<button class="kg-row" data-action="qq-open" data-mid="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist || '')}">
      <span class="kg-rank">${index + 1}</span>
      <span class="kg-cover">♪</span>
      <span class="kg-info">
        <span class="kg-name">${escapeHtml(item.title)}</span>
        <span class="kg-artist">${escapeHtml(item.artist)}</span>
      </span>
      <span class="kg-hot"></span>
      <span class="kg-len">QQ音乐</span>
    </button>`
      )
      .join('')}</div>
      <div class="music-more-row">
        <button class="music-more" data-action="qq-search-page">在 QQ 音乐查看全部</button>
      </div>
      <p class="kg-tip">点击歌曲会在软件内打开 QQ 音乐官方页面；VIP/付费曲目需登录 QQ 音乐账号后播放。</p>`
  }
  return `${search}${stars}${body}`
}

function renderOfficial(key) {
  const conf = OFFICIAL_PLATFORMS[key]
  const st = officialSlot(key)
  return `<form class="kg-search" id="offForm" data-platform="${key}">
      <input id="offKeyword" type="search" placeholder="${conf.placeholder}" value="${escapeHtml(st.keyword)}" />
      <button type="submit" class="music-more">打开${conf.title}</button>
    </form>
    <div class="music-chips">
      ${conf.defaults
        .map(
          (name) =>
            `<button class="music-chip" data-action="platform-open" data-platform="${key}" data-keyword="${name}">${name}</button>`
        )
        .join('')}
    </div>
    <div class="dy-panel">
      <p class="dy-tip">${conf.tip}</p>
    </div>`
}

function registerTempWeb(key, title, artist, url, source) {
  state.webMap.set(key, {
    key,
    title,
    pic: '',
    year: '',
    type: '',
    remarks: artist,
    source,
    audio: true,
    episodes: [{ name: '播放', url }]
  })
}

async function playKugou(hash, albumId, title, artist) {
  const key = `w:kg::${hash}`
  if (bridge && typeof bridge.kugouUrl === 'function') {
    toast('正在获取酷狗播放链接…')
    const data = await bridge.kugouUrl({ hash, albumId })
    if (data && data.url) {
      registerTempWeb(key, title, artist, data.url, '酷狗音乐')
      playWeb(state.webMap.get(key), 0)
      return
    }
    toast((data && data.error) || '获取播放链接失败，已打开酷狗官方窗口')
  }
  if (bridge && typeof bridge.openKugou === 'function') bridge.openKugou({ hash, albumId })
}

async function playQq(mid, title, artist) {
  const key = `w:qq::${mid}`
  if (bridge && typeof bridge.qqUrl === 'function') {
    toast('正在获取 QQ 音乐播放链接…')
    const data = await bridge.qqUrl({ mid })
    if (data && data.url) {
      registerTempWeb(key, title, artist, data.url, 'QQ音乐')
      playWeb(state.webMap.get(key), 0)
      return
    }
    toast((data && data.error) || '获取播放链接失败，已打开 QQ 音乐官方窗口')
  }
  if (bridge && typeof bridge.openQq === 'function') bridge.openQq({ mid })
}

function qsSlot() {
  const slot = categorySlot('music')
  if (!slot.qs) {
    slot.qs = {
      loading: false,
      keyword: '周杰伦',
      list: [],
      total: 0,
      error: '',
      sort: 'recommend',
      freeOnly: false,
      loggedIn: false,
      login: null
    }
  }
  return slot.qs
}

async function refreshQishuiLoginState() {
  if (!bridge || typeof bridge.qishuiStatus !== 'function') return
  const status = await bridge.qishuiStatus()
  const next = Boolean(status && status.loggedIn)
  const qs = qsSlot()
  if (qs.loggedIn === next) return
  qs.loggedIn = next
  if (state.view === 'music') render()
}

async function openQishuiLogin(fresh) {
  const qs = qsSlot()
  if (!bridge || typeof bridge.qishuiQr !== 'function') {
    toast('当前版本不支持扫码登录')
    return
  }
  qs.login = { dataUrl: '', loading: true, error: '' }
  if (state.view === 'music') render()
  const data = await bridge.qishuiQr({ fresh: Boolean(fresh) })
  const current = qsSlot()
  if (!current.login) return
  if (data && data.loggedIn) {
    current.login = null
    toast('抖音账号已登录，会员曲目将按账号权益播放')
    if (state.view === 'music') render()
    loadQishui()
    return
  }
  current.login = {
    dataUrl: (data && data.dataUrl) || '',
    loading: false,
    error: (data && data.error) || ''
  }
  if (state.view === 'music') render()
  startQishuiWatch()
}

function finishQishuiLogin() {
  const qs = qsSlot()
  if (!state.qishuiWatch && !qs.login) return
  if (state.qishuiWatch) {
    clearInterval(state.qishuiWatch)
    state.qishuiWatch = null
  }
  qs.login = null
  qs.loggedIn = true
  if (bridge && typeof bridge.qishuiLoginClose === 'function') bridge.qishuiLoginClose()
  toast('抖音账号登录成功，会员曲目按账号权益播放')
  if (state.view === 'music') render()
  loadQishui()
}

function bindQishuiLogin() {
  if (state.qishuiLoginBound) return
  state.qishuiLoginBound = true
  if (bridge && typeof bridge.onQishuiLogin === 'function') {
    bridge.onQishuiLogin(() => finishQishuiLogin())
  }
}

function startQishuiWatch() {
  bindQishuiLogin()
  if (state.qishuiWatch) clearInterval(state.qishuiWatch)
  state.qishuiWatch = setInterval(async () => {
    if (!bridge || typeof bridge.qishuiStatus !== 'function') return
    const status = await bridge.qishuiStatus()
    if (!status || !status.loggedIn) return
    finishQishuiLogin()
  }, 2000)
}

function closeQishuiLogin() {
  qsSlot().login = null
  if (state.qishuiWatch) {
    clearInterval(state.qishuiWatch)
    state.qishuiWatch = null
  }
  if (bridge && typeof bridge.qishuiLoginClose === 'function') bridge.qishuiLoginClose()
  if (state.view === 'music') render()
}

async function loadQishui(keyword) {
  const qs = qsSlot()
  if (keyword != null) qs.keyword = String(keyword).trim()
  if (!qs.keyword) return
  if (!bridge || typeof bridge.qishuiSearch !== 'function') {
    qs.error = '当前版本不支持汽水音乐曲库'
    if (state.view === 'music') render()
    return
  }
  qs.loading = true
  qs.error = ''
  if (state.view === 'music') render()
  const data = await bridge.qishuiSearch({ keyword: qs.keyword })
  if (data && Array.isArray(data.list)) {
    qs.list = data.list
    qs.total = Number(data.total) || data.list.length
  } else {
    qs.error = (data && data.error) || '汽水音乐搜索失败，请检查网络后重试'
  }
  qs.loading = false
  if (state.view === 'music') render()
}

function qsRowHtml(item, index) {
  return `<button class="kg-row" data-action="qs-open" data-qid="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist || '')}">
    <span class="kg-rank">${index + 1}</span>
    <span class="kg-cover">♪</span>
    <span class="kg-info">
      <span class="kg-name">${escapeHtml(item.title)}</span>
      <span class="kg-artist">${escapeHtml([item.artist, item.album].filter(Boolean).join(' · '))}</span>
    </span>
    <span class="kg-hot">${item.vip ? '会员·试听' : ''}</span>
    <span class="kg-len">${fmtDuration(item.duration)}</span>
  </button>`
}

function renderQishui() {
  const qs = qsSlot()
  const sort = qs.sort || 'recommend'
  const freeCount = qs.list.filter((item) => !item.vip).length
  let list = [...qs.list]
  if (qs.freeOnly) list = list.filter((item) => !item.vip)
  if (sort === 'free') {
    list.sort((a, b) => Number(Boolean(a.vip)) - Number(Boolean(b.vip)))
  }
  const search = `<form class="kg-search" id="qsForm">
      <input id="qsKeyword" type="search" placeholder="搜索歌手或歌曲，如：周杰伦" value="${escapeHtml(qs.keyword)}" />
      <button type="submit" class="music-more">搜索</button>
    </form>`
  const stars = `<div class="music-chips">
      ${KUGOU_STARS.map(
        (name) =>
          `<button class="music-chip${name === qs.keyword ? ' active' : ''}" data-action="qs-star" data-keyword="${name}">${name}</button>`
      ).join('')}
      <span class="music-count">${qs.total ? `${qs.total} 首` : ''}</span>
    </div>`
  const sorts = `<div class="cc-sorts">
      <span class="cc-sort-label">排列</span>
      <button class="music-chip cc-sort${sort === 'recommend' ? ' active' : ''}" data-action="qs-sort" data-sort="recommend">推荐</button>
      <button class="music-chip cc-sort${sort === 'free' ? ' active' : ''}" data-action="qs-sort" data-sort="free">免费优先</button>
      <button class="music-chip cc-sort${qs.freeOnly ? ' active' : ''}" data-action="qs-free">只看免费${freeCount ? `（${freeCount}）` : ''}</button>
      <button class="music-chip cc-sort${qs.loggedIn ? ' active' : ''}" data-action="music-login" data-platform="qishui">${qs.loggedIn ? '已登录·换账号' : '扫码登录'}</button>
      <button class="music-chip cc-sort" data-action="qs-vip">开通会员</button>
    </div>`
  const loginCard = qs.login
    ? `<div class="qr-card">
        <div class="qr-head">
          <span>扫一扫登录汽水音乐</span>
          <button class="qr-close" data-action="qs-qr-close">×</button>
        </div>
        ${
          qs.login.loading
            ? '<div class="loading-note"><span class="spinner"></span>正在获取登录二维码…</div>'
            : qs.login.dataUrl
              ? `<img class="qr-img" src="${qs.login.dataUrl}" alt="登录二维码" />
                 <p class="qr-tip">打开抖音 App，点左上角「扫一扫」，扫描上方二维码并确认登录。登录后在账号权益范围内的歌曲可直接播放完整版。</p>
                 <button class="music-more" data-action="qs-qr-refresh">二维码过期？刷新</button>`
              : `<div class="folder-empty">${escapeHtml(qs.login.error || '二维码获取失败')}<button class="music-more" data-action="qs-qr-refresh">重新获取</button></div>`
        }
      </div>`
    : ''
  let body = ''
  if (qs.loading) {
    body = '<div class="loading-note"><span class="spinner"></span>正在从汽水音乐检索…</div>'
  } else if (qs.error) {
    body = `<div class="folder-empty">${escapeHtml(qs.error)}，<button class="music-more" data-action="qs-star" data-keyword="${escapeHtml(qs.keyword)}">重试</button></div>`
  } else if (!list.length) {
    body = qs.freeOnly
      ? `<div class="folder-empty">这次搜索没有免费曲目，可以取消「只看免费」查看会员曲，或换个歌手名字试试。<button class="music-more" data-action="qs-free">取消只看免费</button></div>`
      : '<div class="folder-empty">没有找到歌曲，换个歌手名字试试。</div>'
  } else {
    body = `<div class="kg-list">${list.map(qsRowHtml).join('')}</div>
      <p class="kg-tip">标记「会员·试听」的曲目，平台只提供约 30 秒试听片段，完整版需开通汽水会员；未标记的曲目为免费音源，可直接在软件内播放。曲目版权归汽水音乐及版权方所有。</p>`
  }
  return `${search}${stars}${sorts}${loginCard}${body}`
}

async function playQishui(trackId, title, artist) {
  const key = `w:qs::${trackId}`
  if (!bridge || typeof bridge.qishuiUrl !== 'function') {
    toast('当前版本不支持汽水音乐播放')
    return
  }
  toast('正在解析汽水音乐…')
  const info = await bridge.qishuiUrl({ trackId })
  if (info && info.url) {
    if (info.playAuth && typeof bridge.qishuiDecrypt === 'function') {
      toast('正在解密汽水音乐音频…')
      const result = await bridge.qishuiDecrypt({ trackId, url: info.url, playAuth: info.playAuth })
      if (result && result.path) {
        registerTempWeb(key, title, artist, encodePath(result.path), '汽水音乐')
        playWeb(state.webMap.get(key), 0)
        return
      }
      toast((result && result.error) || '汽水音乐解密失败，请先扫码登录后再试')
      return
    }
    if (typeof bridge.qishuiCache === 'function') {
      toast('正在缓存汽水音乐音频…')
      const cached = await bridge.qishuiCache({ trackId, url: info.url })
      if (cached && cached.path) {
        const source = info.vip ? '汽水音乐 · 会员试听' : '汽水音乐'
        registerTempWeb(key, title, artist, encodePath(cached.path), source)
        playWeb(state.webMap.get(key), 0)
        if (info.vip) toast('会员曲目：当前只有平台提供的约 30 秒试听，完整版需开通汽水会员')
        return
      }
      toast((cached && cached.error) || '汽水音乐音频缓存失败，请稍后重试')
      return
    }
    registerTempWeb(key, title, artist, info.url, '汽水音乐')
    playWeb(state.webMap.get(key), 0)
    if (info.vip) toast('会员曲目：当前只有平台提供的约 30 秒试听，完整版需开通汽水会员')
    return
  }
  toast((info && info.error) || '汽水音乐解析失败，请稍后重试')
}

function openPlatform(key, keyword) {
  const kw = String(keyword || '').trim()
  if (key === 'douyin' && bridge && typeof bridge.openDouyin === 'function') {
    return bridge.openDouyin({ keyword: kw })
  }
  if (key === 'kuaishou' && bridge && typeof bridge.openKuaishou === 'function') {
    return bridge.openKuaishou({ keyword: kw })
  }
  if (key === 'qishui' && bridge && typeof bridge.openQishui === 'function') {
    return bridge.openQishui({ keyword: kw })
  }
  return ''
}

const MUSIC_SOURCES = [
  { key: 'web', label: '片源曲库' },
  { key: 'cc', label: 'CC 免费曲库' },
  { key: 'tt', label: '晴晴音阁' }
]

function renderMusicCategory(conf, slot) {
  const source = ['web', 'cc', 'tt'].includes(slot.musicSource) ? slot.musicSource : 'tt'
  if (source === 'cc') return renderCcMusic(slot)
  if (source === 'tt') return renderTtPlayer(slot)

  const tag = slot.musicTag || '全部'
  const status = slot.loading ? '正在加载…' : `${slot.results.length} 首`
  const items = slot.results.filter((item) => musicMatch(item, tag))
  let body = ''
  if (slot.loading) {
    body = `<div class="loading-note"><span class="spinner"></span>正在加载${conf.title}…</div>`
  } else if (items.length) {
    body = `<div class="music-grid">${items.map(musicCardHtml).join('')}</div>`
  } else {
    body = `<div class="folder-empty">暂未找到相关音乐内容，可在设置里添加更多搜索源后重试。</div>`
  }
  return `<div class="music-chips">
      ${MUSIC_TAGS.map(
        (entry) =>
          `<button class="music-chip${entry.name === tag ? ' active' : ''}" data-action="music-tag" data-tag="${entry.name}">${entry.name}</button>`
      ).join('')}
      <span class="music-count">${status}</span>
    </div>${body}`
}

const ttAudio = new Audio()
let ttAudioBound = false
ttAudio.preload = 'metadata'

const TT_VOL_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5l-5 4z" fill="currentColor" stroke="none" /><path d="M16.5 8.4c1.6 1.7 1.6 5.5 0 7.2" /></svg>'
const TT_VOL_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5l-5 4z" fill="currentColor" stroke="none" /><path d="m16 9 4 6M20 9l-4 6" /></svg>'
let ttLastVolume = 0.8

try {
  const savedRaw = localStorage.getItem('gyMusicVolume')
  if (savedRaw !== null) {
    const saved = Number(savedRaw)
    if (Number.isFinite(saved) && saved >= 0 && saved <= 1) ttAudio.volume = saved
  }
  if (ttAudio.volume > 0) ttLastVolume = ttAudio.volume
} catch {
  /* 忽略存储异常 */
}

function ttApplyVolume(input) {
  const value = Math.max(0, Math.min(1, Number(input) || 0))
  ttAudio.volume = value
  if (value > 0) ttLastVolume = value
  try {
    localStorage.setItem('gyMusicVolume', String(value))
  } catch {
    /* 忽略存储异常 */
  }
  const btn = document.getElementById('ttMuteBtn')
  const range = document.getElementById('ttVolumeRange')
  const num = document.getElementById('ttVolNum')
  if (btn) btn.innerHTML = value > 0 ? TT_VOL_ON : TT_VOL_OFF
  if (btn) btn.classList.toggle('muted', value === 0)
  if (range && document.activeElement !== range) range.value = String(value)
  if (num) num.textContent = `${Math.round(value * 100)}%`
}

function ttSlot() {
  const slot = categorySlot('music')
  if (!slot.tt) {
    slot.tt = {
      index: 0,
      mode: 'order',
      currentId: '',
      songs: [],
      query: '',
      vendor: 'netease',
      loading: false,
      loaded: false,
      error: '',
      failStreak: 0,
      toplists: [],
      toplistsLoading: false,
      panel: 'list',
      openPlaylist: '',
      renaming: '',
      picker: null,
      toolsOpen: false,
      toolsTimer: 0
    }
  }
  return slot.tt
}

/* 音乐厅右侧搜索面板：搜索期间保持展开，结束后再自动收起 */
function ttToolsHold() {
  const tt = ttSlot()
  window.clearTimeout(tt.toolsTimer)
  tt.toolsTimer = 0
  if (!tt.toolsOpen) {
    tt.toolsOpen = true
    if (state.view === 'music') render()
  }
}

function ttToolsTouch() {
  const tt = ttSlot()
  window.clearTimeout(tt.toolsTimer)
  tt.toolsTimer = 0
}

function ttToolsSearchEnd() {
  const tt = ttSlot()
  if (!tt.toolsOpen) return
  window.clearTimeout(tt.toolsTimer)
  tt.toolsTimer = window.setTimeout(() => {
    // 搜索还没结束就继续等，不收起搜索框
    if (tt.loading) {
      ttToolsSearchEnd()
      return
    }
    tt.toolsOpen = false
    if (state.view === 'music') render()
  }, 6000)
}

/* ---------- 千千静听 收藏 / 歌单 ---------- */

const TT_LIB_KEY = 'gyMusicLibV1'
let ttLibCache = null

function musicLibData() {
  if (ttLibCache) return ttLibCache
  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(TT_LIB_KEY) || 'null')
  } catch {
    saved = null
  }
  const clean = (song) => song && song.vendor && song.id && song.title
  ttLibCache = {
    favorites: Array.isArray(saved && saved.favorites) ? saved.favorites.filter(clean) : [],
    playlists: Array.isArray(saved && saved.playlists)
      ? saved.playlists
          .filter((item) => item && item.id)
          .map((item) => ({
            id: String(item.id),
            name: String(item.name || '我的歌单'),
            songs: Array.isArray(item.songs) ? item.songs.filter(clean) : []
          }))
      : []
  }
  return ttLibCache
}

function musicLibSave() {
  try {
    localStorage.setItem(TT_LIB_KEY, JSON.stringify(musicLibData()))
  } catch {
    /* 忽略存储异常 */
  }
}

function ttSongKey(song) {
  return song ? `${song.vendor}:${song.id}` : ''
}

function ttSongFromTrack(track) {
  const song = track && track.song
  if (!song) return null
  return {
    vendor: song.vendor,
    id: song.id,
    title: song.title,
    artist: song.artist || '',
    copyrightId: song.copyrightId || '',
    resourceType: song.resourceType || '2'
  }
}

function ttTrackFromSong(song) {
  const track =
    song.vendor === 'migu'
      ? {
          id: `ttm:${song.id}`,
          title: song.title,
          artist: song.artist || '咪咕音乐',
          url: song.url || '',
          source: '咪咕音乐',
          failed: !!song.failed,
          migu: {
            contentId: song.id,
            copyrightId: song.copyrightId || '',
            resourceType: song.resourceType || '2'
          }
        }
      : {
          id: `ttn:${song.id}`,
          title: song.title,
          artist: song.artist || '网易云音乐',
          url: `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`,
          source: '网易云',
          failed: !!song.failed
        }
  track.song = song
  return track
}

function ttFindSongByKey(key) {
  if (!key) return null
  const tt = ttSlot()
  const fromList = tt.songs.find((song) => ttSongKey(song) === key)
  if (fromList) return fromList
  const lib = musicLibData()
  const fromFav = lib.favorites.find((song) => ttSongKey(song) === key)
  if (fromFav) return fromFav
  for (const playlist of lib.playlists) {
    const found = playlist.songs.find((song) => ttSongKey(song) === key)
    if (found) return found
  }
  return null
}

function ttIsFavorite(song) {
  if (!song) return false
  const key = ttSongKey(song)
  return musicLibData().favorites.some((entry) => ttSongKey(entry) === key)
}

function ttToggleFavorite(song) {
  if (!song) return
  const lib = musicLibData()
  const key = ttSongKey(song)
  const index = lib.favorites.findIndex((entry) => ttSongKey(entry) === key)
  if (index >= 0) {
    lib.favorites.splice(index, 1)
    toast('已取消喜欢')
  } else {
    lib.favorites.unshift(ttSongFromTrack({ song }))
    toast('已添加到「我喜欢」')
  }
  musicLibSave()
  if (state.view === 'music') render()
}

function ttAddToPlaylist(playlistId, song) {
  if (!song) return
  const lib = musicLibData()
  const playlist = lib.playlists.find((item) => item.id === playlistId)
  if (!playlist) return
  const key = ttSongKey(song)
  if (playlist.songs.some((entry) => ttSongKey(entry) === key)) {
    toast(`「${playlist.name}」里已经有这首歌`)
    return
  }
  playlist.songs.push(ttSongFromTrack({ song }))
  musicLibSave()
  ttSlot().picker = null
  toast(`已添加到「${playlist.name}」`)
  if (state.view === 'music') render()
}

function ttCreatePlaylist(name, song) {
  const lib = musicLibData()
  const id = `pl${Date.now().toString(36)}`
  const title = String(name || '').trim() || `我的歌单 ${lib.playlists.length + 1}`
  const playlist = { id, name: title, songs: [] }
  if (song) playlist.songs.push(ttSongFromTrack({ song }))
  lib.playlists.push(playlist)
  musicLibSave()
  ttSlot().picker = null
  toast(`已新建歌单「${title}」`)
  if (state.view === 'music') render()
  return playlist
}

function ttActiveList() {
  const tt = ttSlot()
  const lib = musicLibData()
  if (tt.panel === 'fav') return lib.favorites.map(ttTrackFromSong)
  if (tt.panel === 'pl' && tt.openPlaylist) {
    const playlist = lib.playlists.find((item) => item.id === tt.openPlaylist)
    return playlist ? playlist.songs.map(ttTrackFromSong) : []
  }
  return ttBuildList()
}

/* ---------- 千千静听 歌词 ---------- */

function ttLyricSlot() {
  const tt = ttSlot()
  if (!tt.lyric) tt.lyric = { key: '', lines: [], trMap: {}, loading: false, error: '', active: -1 }
  return tt.lyric
}

const TT_LYRIC_MODES = [
  { id: 'motion', label: '动感' },
  { id: 'scroll', label: '滚动' },
  { id: 'single', label: '单行' },
  { id: 'ktv', label: 'KTV' }
]

function ttLyricMode() {
  const mode = ttSlot().lyricMode
  return TT_LYRIC_MODES.some((item) => item.id === mode) ? mode : 'scroll'
}

function ttParseLrc(text) {
  const lines = []
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const stamp = /^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(line)
      if (!stamp) return
      const content = line.replace(/\[[^\]]*\]/g, '').trim()
      const second = Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || 0}`)
      if (!content) return
      lines.push({ time: second, text: content })
    })
  return lines.sort((a, b) => a.time - b.time)
}

async function ensureTtLyric() {
  const tt = ttSlot()
  const lyric = ttLyricSlot()
  const song = tt.playingSong
  if (!song) {
    lyric.key = ''
    lyric.lines = []
    lyric.active = -1
    lyric.error = ''
    return
  }
  const key = ttSongKey(song)
  if (lyric.key === key) return
  lyric.key = key
  lyric.lines = []
  lyric.trMap = {}
  lyric.active = -1
  lyric.error = ''
  lyric.loading = true
  if (state.view === 'music') render()

  let neteaseId = song.vendor === 'netease' ? song.id : ''
  // 非网易云歌曲：通过网易云搜索同名歌曲来获取歌词
  if (!neteaseId) {
    try {
      const kw = `${song.name || ''} ${song.artist || ''}`.trim()
      const search = await bridge.neteaseSearch({ keyword: kw, limit: 20 })
      if (search && Array.isArray(search.list) && search.list.length) {
        neteaseId = search.list[0].id
      }
    } catch {
      neteaseId = ''
    }
  }

  let result = null
  if (neteaseId) {
    try {
      result = await bridge.neteaseLyric({ id: neteaseId })
    } catch {
      result = null
    }
  }
  if (lyric.key !== key) return
  lyric.loading = false
  lyric.lines = ttParseLrc(result && result.lyric)
  const trLines = ttParseLrc(result && result.tlyric)
  lyric.trMap = {}
  trLines.forEach((line) => {
    lyric.trMap[Math.round(line.time * 10) / 10] = line.text
  })
  if (!lyric.lines.length) lyric.error = '暂无歌词'
  if (state.view === 'music') render()
}

function ttLyricStageHtml(lyric, active, mode) {
  const index = Math.max(0, active)
  const line = lyric.lines[index]
  const next = lyric.lines[index + 1]
  const text = line ? line.text : ''
  if (mode === 'ktv') {
    const repeat = text ? `<span class="tt-ktv-text">${escapeHtml(text)}</span><span class="tt-ktv-text">${escapeHtml(text)}</span>` : ''
    return `<div class="tt-lyric-ktv" data-text="${escapeHtml(text)}">
      <div class="tt-ktv-scroll">${repeat}</div>
    </div>`
  }
  const tr = line ? lyric.trMap[Math.round(line.time * 10) / 10] : ''
  return `<div class="tt-lyric-single">
    <span class="tt-lyric-cur">${escapeHtml(text)}</span>
    ${tr ? `<span class="tt-lyric-tr">${escapeHtml(tr)}</span>` : ''}
    <span class="tt-lyric-next">${escapeHtml(next ? next.text : '')}</span>
  </div>`
}

function ttSyncLyric(time) {
  const lyric = ttSlot().lyric
  if (!lyric || !lyric.lines.length) return
  let active = -1
  for (let i = 0; i < lyric.lines.length; i += 1) {
    if (lyric.lines[i].time <= time + 0.2) active = i
    else break
  }
  const mode = ttLyricMode()
  const stage = document.getElementById('ttLyricStage')
  if (stage) {
    if (stage.dataset.active !== String(active)) {
      stage.dataset.active = String(active)
      stage.innerHTML = ttLyricStageHtml(lyric, active, mode)
      if (mode === 'ktv') applyKtvScroll(stage)
    }
  }
  if (mode === 'single' || mode === 'ktv') {
    lyric.active = active
    return
  }
  if (active === lyric.active) return
  lyric.active = active
  const wrap = document.getElementById('ttLyric')
  if (!wrap) return
  const rows = wrap.querySelectorAll('.tt-lyric-line')
  rows.forEach((row, index) => row.classList.toggle('active', index === active))
  const current = rows[active]
  if (current) {
    wrap.scrollTop = Math.max(0, current.offsetTop - wrap.clientHeight / 2 + current.offsetHeight / 2)
  }
}

/* KTV 单行歌词：一行文字从右往左循环滚动，文字过长时自动加速 */
function applyKtvScroll(stage) {
  const scroll = stage.querySelector('.tt-ktv-scroll')
  if (!scroll) return
  scroll.classList.remove('gy-ktv-run')
  scroll.style.removeProperty('--gy-ktv-duration')
  const copy = scroll.firstElementChild
  if (!copy) return
  const copyWidth = copy.offsetWidth
  const viewWidth = stage.clientWidth
  if (!copyWidth || copyWidth <= viewWidth - 8) return
  const duration = Math.max(6, Math.round((copyWidth + viewWidth) / 55))
  scroll.style.setProperty('--gy-ktv-duration', `${duration}s`)
  scroll.classList.add('gy-ktv-run')
}

/* ---------- 动感频谱 ---------- */

const TT_MOTION_STYLES = [
  { id: 'bars', label: '经典柱状' },
  { id: 'mirror', label: '镜像柱' },
  { id: 'radial', label: '径向环形' },
  { id: 'dots', label: '圆点频谱' },
  { id: 'waterfall', label: '瀑布频谱' },
  { id: 'wave', label: '波形示波' },
  { id: 'ripple', label: '同心圆波纹' },
  { id: 'particles', label: '粒子流' },
  { id: 'mandala', label: '万花筒' },
  { id: 'ribbon', label: '光带丝带' },
  { id: 'terrain', label: '3D 山峦' }
]

let ttMotionStyleCache = ''

function ttMotionStyle() {
  if (ttMotionStyleCache) return ttMotionStyleCache
  let saved = ''
  try {
    saved = localStorage.getItem('gyMotionStyle') || ''
  } catch {
    saved = ''
  }
  ttMotionStyleCache = TT_MOTION_STYLES.some((item) => item.id === saved) ? saved : 'bars'
  return ttMotionStyleCache
}

function ttMotionStyleInfo() {
  return TT_MOTION_STYLES.find((item) => item.id === ttMotionStyle()) || TT_MOTION_STYLES[0]
}

function ttMotionHtml() {
  return `<div class="tt-motion" data-action="tt-motion-next" title="轻点切换动感效果">
      <canvas id="ttMotionCanvas"></canvas>
      <span class="tt-motion-name" id="ttMotionName">${ttMotionStyleInfo().label} · 轻点切换</span>
    </div>`
}

let ttMotionNameTimer = 0

function ttShowMotionName(delay = 2200) {
  if (ttMotionNameTimer) clearTimeout(ttMotionNameTimer)
  const label = document.getElementById('ttMotionName')
  if (!label) return
  label.classList.remove('hide')
  ttMotionNameTimer = setTimeout(() => {
    const el = document.getElementById('ttMotionName')
    if (el) el.classList.add('hide')
    ttMotionNameTimer = 0
  }, delay)
}

function ttMotionNextStyle() {
  const index = TT_MOTION_STYLES.findIndex((item) => item.id === ttMotionStyle())
  const next = TT_MOTION_STYLES[(index + 1) % TT_MOTION_STYLES.length]
  ttMotionStyleCache = next.id
  try {
    localStorage.setItem('gyMotionStyle', next.id)
  } catch {
    /* 忽略存储异常 */
  }
  if (state.view === 'music') render()
  ttShowMotionName(2200)
}

let ttMotionRaf = 0
let ttMotionActive = false
let ttMotionFrameAt = 0
let ttMotionLevels = []
let ttMotionPeaks = []
let ttMotionWater = []
let ttMotionDropAt = 0
let ttMotionParticles = []

function ttMotionEnergy(t) {
  const active = !ttAudio.paused && ttAudio.src && ttAudio.volume > 0
  // 未播放时保持可见的缓速律动，保证动感频谱始终显示
  if (!active) return 0.42
  const beat = Math.pow(Math.max(0, Math.sin(t * 8.5)), 6)
  return 0.5 + 0.3 * ttAudio.volume + 0.28 * beat
}

function ttMotionTarget(i, count, t, energy) {
  const k = count > 1 ? i / (count - 1) : 0
  const w1 = Math.sin(t * (1.1 + i * 0.33) + i * 1.6) * 0.5 + 0.5
  const w2 = Math.sin(t * (2.4 + i * 0.12) + i * 4.1) * 0.5 + 0.5
  const w3 = Math.sin(t * (0.6 + k * 1.8) - i * 0.07) * 0.5 + 0.5
  const falloff = 0.3 + 0.7 * Math.pow(1 - k, 0.7)
  return Math.min(1, energy * (0.18 + 0.82 * (w1 * 0.45 + w2 * 0.35 + w3 * 0.2)) * falloff)
}

function ttMotionColor(k, alpha) {
  return `hsla(${Math.round(192 + k * 66)}, 92%, 64%, ${alpha})`
}

function ttMotionCtx(canvas) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!width || !height) return null
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const pxW = Math.round(width * dpr)
  const pxH = Math.round(height * dpr)
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW
    canvas.height = pxH
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w: width, h: height }
}

function ttDrawBars(ctx, w, h, mirror) {
  const n = ttMotionLevels.length
  const gap = Math.max(2, (w / n) * 0.3)
  const bw = Math.max(1, (w - gap * (n - 1)) / n)
  const base = mirror ? h / 2 : h
  const span = mirror ? h / 2 : h
  for (let i = 0; i < n; i += 1) {
    const k = i / Math.max(1, n - 1)
    const level = ttMotionLevels[i]
    const bh = Math.max(2, level * span * 0.88)
    const x = i * (bw + gap)
    const grad = ctx.createLinearGradient(0, base - bh, 0, base)
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)')
    grad.addColorStop(0.35, ttMotionColor(k, 0.95))
    grad.addColorStop(1, ttMotionColor(k, 0.2))
    ctx.fillStyle = grad
    ctx.fillRect(x, base - bh, bw, bh)
    if (mirror) ctx.fillRect(x, base, bw, bh)
    const peakY = base - ttMotionPeaks[i] * span * 0.88
    ctx.fillStyle = 'rgba(255, 236, 190, 0.9)'
    ctx.fillRect(x, peakY, bw, 1.5)
    if (mirror) ctx.fillRect(x, base + ttMotionPeaks[i] * span * 0.88, bw, 1.5)
  }
}

function ttDrawRadial(ctx, w, h, t) {
  const cx = w / 2
  const cy = h / 2
  const n = ttMotionLevels.length
  const inner = Math.min(w, h) * 0.13
  const maxLen = Math.min(w, h) * 0.34
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(t * 0.25)
  for (let i = 0; i < n; i += 1) {
    const ang = (i / n) * Math.PI * 2
    const len = inner + ttMotionLevels[i] * maxLen
    ctx.strokeStyle = ttMotionColor(i / Math.max(1, n - 1), 0.92)
    ctx.lineWidth = Math.max(2, (Math.PI * 2 * inner) / n * 0.62)
    ctx.beginPath()
    ctx.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner)
    ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(140, 215, 255, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(0, 0, inner - 3, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function ttDrawDots(ctx, w, h) {
  const cols = Math.min(34, Math.max(16, Math.round(w / 20)))
  const rows = 9
  const gapX = w / cols
  const gapY = h / rows
  const r = Math.max(1.6, Math.min(gapX, gapY) * 0.28)
  for (let c = 0; c < cols; c += 1) {
    const idx = Math.round((c / Math.max(1, cols - 1)) * (ttMotionLevels.length - 1))
    const level = ttMotionLevels[idx]
    const lit = Math.round(level * rows)
    for (let row = 0; row < rows; row += 1) {
      const x = gapX * (c + 0.5)
      const y = h - gapY * (row + 0.5)
      ctx.beginPath()
      if (row < lit) {
        ctx.fillStyle = ttMotionColor(c / Math.max(1, cols - 1), 0.35 + (row / rows) * 0.65)
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'
      }
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function ttDrawWaterfall(ctx, w, h, t) {
  if (t - ttMotionDropAt > 0.08) {
    ttMotionDropAt = t
    const rows = 24
    const col = []
    for (let r = 0; r < rows; r += 1) {
      const idx = Math.round((r / (rows - 1)) * (ttMotionLevels.length - 1))
      col.push(ttMotionLevels[idx])
    }
    ttMotionWater.push(col)
  }
  const maxCols = Math.max(10, Math.floor(w / 6))
  while (ttMotionWater.length > maxCols) ttMotionWater.shift()
  const cellW = w / maxCols
  const cellH = h / 24
  const offset = maxCols - ttMotionWater.length
  for (let c = 0; c < ttMotionWater.length; c += 1) {
    const col = ttMotionWater[c]
    for (let r = 0; r < 24; r += 1) {
      ctx.fillStyle = ttMotionColor(r / 23, 0.1 + col[r] * 0.86)
      ctx.fillRect((offset + c) * cellW, h - (r + 1) * cellH, cellW + 0.5, cellH + 0.5)
    }
  }
  const grad = ctx.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, 'rgba(3, 11, 17, 0)')
  grad.addColorStop(1, 'rgba(3, 11, 17, 0.55)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

function ttDrawWave(ctx, w, h, t) {
  const n = ttMotionLevels.length
  const mid = h / 2
  const draw = (phase, alpha, width) => {
    ctx.beginPath()
    for (let x = 0; x <= w; x += 2) {
      const k = x / w
      const idx = k * (n - 1)
      const i0 = Math.floor(idx)
      const i1 = Math.min(n - 1, i0 + 1)
      const v = ttMotionLevels[i0] * (1 - (idx - i0)) + ttMotionLevels[i1] * (idx - i0)
      const amp = v * h * 0.34
      const y = mid + Math.sin(k * 16 + t * 6 + phase) * amp
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = ttMotionColor(0.35, alpha)
    ctx.lineWidth = width
    ctx.stroke()
  }
  ctx.shadowBlur = 12
  ctx.shadowColor = 'rgba(110, 200, 255, 0.7)'
  draw(0, 0.95, 2.2)
  draw(Math.PI, 0.4, 1.4)
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(w, mid)
  ctx.stroke()
}

function ttDrawRipple(ctx, w, h, t) {
  const cx = w / 2
  const cy = h / 2
  const maxR = Math.max(w, h) * 0.55
  const avg = ttMotionLevels.reduce((sum, v) => sum + v, 0) / Math.max(1, ttMotionLevels.length)
  for (let i = 0; i < 6; i += 1) {
    const p = (t * (0.16 + avg * 0.2) + i / 6) % 1
    const r = p * maxR
    ctx.strokeStyle = ttMotionColor(p, (1 - p) * 0.75)
    ctx.lineWidth = 1.5 + (1 - p) * 3
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = ttMotionColor(0.5, 0.25)
  ctx.beginPath()
  ctx.arc(cx, cy, 24 + avg * 26, 0, Math.PI * 2)
  ctx.fill()
}

function ttDrawParticles(ctx, w, h, t) {
  const avg = ttMotionLevels.reduce((sum, v) => sum + v, 0) / Math.max(1, ttMotionLevels.length)
  const spawn = Math.round(2 + avg * 9)
  for (let i = 0; i < spawn; i += 1) {
    ttMotionParticles.push({
      x: w * (0.15 + Math.random() * 0.7),
      y: h * 0.52,
      vx: (Math.random() - 0.5) * 2.4,
      vy: -(0.5 + Math.random() * 2.6) * (0.6 + avg),
      life: 1,
      size: 1.5 + Math.random() * 2.8,
      hue: 190 + Math.random() * 70
    })
  }
  while (ttMotionParticles.length > 260) ttMotionParticles.shift()
  ctx.globalCompositeOperation = 'lighter'
  ttMotionParticles.forEach((p) => {
    p.x += p.vx
    p.y += p.vy
    p.vy *= 0.992
    p.life -= 0.012
    ctx.fillStyle = `hsla(${Math.round(p.hue)}, 95%, 68%, ${Math.max(0, p.life) * 0.9})`
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size * Math.max(0.2, p.life), 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.globalCompositeOperation = 'source-over'
  ttMotionParticles = ttMotionParticles.filter((p) => p.life > 0 && p.y > -20)
  const grad = ctx.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, Math.min(w, h) * 0.5)
  grad.addColorStop(0, ttMotionColor(0.4, 0.16 + avg * 0.2))
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

function ttDrawMandala(ctx, w, h, t) {
  const cx = w / 2
  const cy = h / 2
  const n = ttMotionLevels.length
  const base = Math.min(w, h) * 0.16
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(t * 0.18)
  for (let i = 0; i < n; i += 1) {
    const ang = (i / n) * Math.PI * 2
    const len = base + ttMotionLevels[i] * Math.min(w, h) * 0.3
    const wide = Math.max(3, len * 0.16)
    ctx.save()
    ctx.rotate(ang)
    ctx.fillStyle = ttMotionColor(i / Math.max(1, n - 1), 0.22 + ttMotionLevels[i] * 0.5)
    ctx.beginPath()
    ctx.ellipse(len / 2 + base / 2, 0, len / 2, wide, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.35)'
  ctx.lineWidth = 1
  for (let ring = 1; ring <= 3; ring += 1) {
    ctx.beginPath()
    for (let s = 0; s <= 48; s += 1) {
      const ang = (s / 48) * Math.PI * 2
      const idx = Math.round((s / 48) * (n - 1))
      const r = base + ring * 18 + ttMotionLevels[idx] * 15 * ring
      const x = Math.cos(ang) * r
      const y = Math.sin(ang) * r
      if (s === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function ttDrawRibbon(ctx, w, h, t) {
  const n = ttMotionLevels.length
  for (let layer = 0; layer < 4; layer += 1) {
    const offset = layer * 0.22
    ctx.beginPath()
    for (let x = 0; x <= w; x += 3) {
      const k = x / w
      const idx = Math.round(k * (n - 1))
      const level = ttMotionLevels[idx]
      const y =
        h * (0.28 + offset) +
        Math.sin(k * 8 + t * 2 + layer * 1.7) * h * 0.14 * (0.4 + level) +
        Math.sin(k * 3 - t * 1.1 + layer) * h * 0.1
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = ttMotionColor(layer / 3, 0.16 + 0.1 * layer)
    ctx.lineWidth = 12 - layer * 2
    ctx.stroke()
    ctx.strokeStyle = ttMotionColor(layer / 3, 0.5)
    ctx.lineWidth = 1.6
    ctx.stroke()
  }
}

function ttDrawTerrain(ctx, w, h, t) {
  const n = ttMotionLevels.length
  const layers = 4
  for (let layer = 0; layer < layers; layer += 1) {
    const baseY = h * (0.4 + layer * 0.14)
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 4) {
      const k = x / w
      const idx = Math.round(((k + layer * 0.12 + t * 0.05) % 1) * (n - 1))
      const level = ttMotionLevels[idx]
      const y = baseY - level * h * (0.22 - layer * 0.03)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, baseY - h * 0.25, 0, h)
    grad.addColorStop(0, ttMotionColor(layer / layers, 0.38))
    grad.addColorStop(1, ttMotionColor(layer / layers, 0.04))
    ctx.fillStyle = grad
    ctx.fill()
    ctx.strokeStyle = ttMotionColor(layer / layers, 0.7)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (let x = 0; x <= w; x += 4) {
      const k = x / w
      const idx = Math.round(((k + layer * 0.12 + t * 0.05) % 1) * (n - 1))
      const level = ttMotionLevels[idx]
      const y = baseY - level * h * (0.22 - layer * 0.03)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

function ttMotionFrame(now) {
  ttMotionRaf = 0
  if (!ttMotionActive) return
  const canvas = document.getElementById('ttMotionCanvas')
  if (!canvas || !canvas.isConnected) {
    ttMotionActive = false
    return
  }
  const size = ttMotionCtx(canvas)
  if (!size) {
    ttMotionSchedule()
    return
  }
  const { ctx, w, h } = size
  try {
    const t = Number(now) / 1000 || 0
    const energy = ttMotionEnergy(t)
    const count = Math.max(16, Math.min(64, Math.round(w / 9)))
    if (ttMotionLevels.length !== count) {
      ttMotionLevels = new Array(count).fill(0)
      ttMotionPeaks = new Array(count).fill(0)
    }
    for (let i = 0; i < count; i += 1) {
      const target = ttMotionTarget(i, count, t, energy)
      ttMotionLevels[i] = ttMotionLevels[i] * 0.55 + target * 0.45
      ttMotionPeaks[i] = Math.max(ttMotionPeaks[i] - 0.004, ttMotionLevels[i])
    }
    ctx.clearRect(0, 0, w, h)
    const style = ttMotionStyle()
    if (style === 'mirror') ttDrawBars(ctx, w, h, true)
    else if (style === 'radial') ttDrawRadial(ctx, w, h, t)
    else if (style === 'dots') ttDrawDots(ctx, w, h)
    else if (style === 'waterfall') ttDrawWaterfall(ctx, w, h, t)
    else if (style === 'wave') ttDrawWave(ctx, w, h, t)
    else if (style === 'ripple') ttDrawRipple(ctx, w, h, t)
    else if (style === 'particles') ttDrawParticles(ctx, w, h, t)
    else if (style === 'mandala') ttDrawMandala(ctx, w, h, t)
    else if (style === 'ribbon') ttDrawRibbon(ctx, w, h, t)
    else if (style === 'terrain') ttDrawTerrain(ctx, w, h, t)
    else ttDrawBars(ctx, w, h, false)
  } catch (err) {
    /* 单帧绘制异常不应终止动感频谱 */
  }
  ttMotionFrameAt = performance.now()
  ttMotionSchedule()
}

function ttMotionSchedule() {
  if (ttMotionRaf || !ttMotionActive) return
  ttMotionRaf = requestAnimationFrame(ttMotionFrame)
}

function ttStartMotion() {
  ttMotionActive = true
  ttMotionFrameAt = performance.now()
  ttMotionSchedule()
}

function ttRestartMotion() {
  if (!ttMotionActive || document.hidden) return
  if (ttMotionRaf) cancelAnimationFrame(ttMotionRaf)
  ttMotionRaf = 0
  ttMotionSchedule()
}

/* 安卓 WebView 在页面不可见/后台时会丢弃已排队的 rAF 回调，
   导致帧循环再也启动不了（频谱空白）。这里用定时器兜底：
   超过 1.2 秒没有新帧就直接补画一帧并重启循环。 */
setInterval(() => {
  if (!ttMotionActive || document.hidden) return
  if (performance.now() - ttMotionFrameAt < 1200) return
  if (ttMotionRaf) cancelAnimationFrame(ttMotionRaf)
  ttMotionRaf = 0
  ttMotionFrame(performance.now())
}, 1000)

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) ttRestartMotion()
})
window.addEventListener('pageshow', ttRestartMotion)
window.addEventListener('focus', ttRestartMotion)

/* 横屏：晴晴音阁窗口底边收在第 5 首歌文字的中线，只完整显示前 4 首；
   竖屏/竖版布局不动（清掉内联值，交给 CSS）。
   .tt-wrap 是 flex:1 的子项，height 会被拉伸覆盖，故用 margin-bottom 从底部收进去（与竖屏同一套做法） */
function ttFitMusicWindowHeight() {
  const wrap = contentEl.querySelector('.tt-wrap')
  if (!wrap) return
  wrap.style.marginBottom = ''
  if (!window.matchMedia('(orientation: landscape)').matches) return
  const box = wrap.querySelector('.tt-playlist .tt-rows')
  if (!box) return
  const rows = box.querySelectorAll('.tt-row')
  if (rows.length < 5) return
  const rowH = rows[0].getBoundingClientRect().height
  if (!rowH) return
  const padTop = parseFloat(getComputedStyle(box).paddingTop) || 0
  const boxTop = box.getBoundingClientRect().top - wrap.getBoundingClientRect().top
  const target = boxTop + padTop + rowH * 4.5
  const delta = Math.round(wrap.getBoundingClientRect().height - target)
  if (delta > 0) wrap.style.marginBottom = `${delta}px`
}

window.addEventListener('resize', ttFitMusicWindowHeight)


function ttTrackFrom(item, sourceLabel) {
  const ep = (item.episodes && item.episodes[0]) || {}
  return {
    id: item.key || `tt::${item.title || ''}::${item.artist || ''}`,
    title: String(item.title || '未知曲目').trim(),
    artist: String(item.artist || item.remarks || '').split('·')[0].trim() || '未知歌手',
    url: ep.url || item.url || '',
    source: sourceLabel || item.source || '千千曲库'
  }
}

function ttBuildList() {
  const tt = ttSlot()
  // 时长不足 3 分钟的试听片段/短曲不进入播放列表（duration 单位为毫秒）
  const longEnough = (track) => {
    let ms = Number((track.song && track.song.duration) || 0)
    // 兼容以「秒」返回时长的接口（咪咕），避免被误判成短曲
    if (ms > 0 && ms < 10000) ms *= 1000
    return !ms || ms >= 180000
  }
  if (tt.songs.length) {
    return tt.songs.map(ttTrackFromSong).filter(longEnough)
  }
  const seen = new Set()
  const list = []
  const push = (items, sourceLabel) => {
    for (const item of items || []) {
      const track = ttTrackFrom(item, sourceLabel)
      if (!track.url || seen.has(track.id)) continue
      seen.add(track.id)
      list.push(track)
    }
  }
  push([...state.webMap.values()].filter((item) => item.audio), '千千曲库')
  push(ccSlot().results, 'CC 免费')
  return list
}

/* 榜单缓存（android-shim.js 写入，这里只读）：进入音乐厅先用上次的列表秒开，再后台刷新 */
const TT_CHART_CACHE_PREFIX = 'gy_chart_'
const TT_CHART_ID = 3778678

function ttChartCacheGet(id) {
  try {
    const raw = localStorage.getItem(TT_CHART_CACHE_PREFIX + id)
    if (!raw) return []
    const data = JSON.parse(raw)
    return data && Array.isArray(data.list) ? data.list : []
  } catch {
    return []
  }
}

async function ttLoadChart() {
  const tt = ttSlot()
  if (tt.loading) return
  tt.query = ''
  tt.vendor = 'netease'
  tt.searchMode = false
  tt.error = ''
  const cached = ttChartCacheGet(TT_CHART_ID)
  const fromCache = cached.length > 0
  if (fromCache) {
    // 有缓存：立刻出列表，不转圈
    tt.songs = cached.map((song) => ({ ...song, vendor: 'netease' }))
    tt.loaded = true
    tt.loading = false
    if (state.view === 'music') render()
  } else {
    tt.loading = true
    if (state.view === 'music') render()
  }
  let result = null
  try {
    result = await bridge.neteaseChart({ id: TT_CHART_ID })
  } catch {
    result = null
  }
  const fresh = result && Array.isArray(result.list) ? result.list : []
  tt.loading = false
  if (fresh.length) {
    tt.loadRetry = 0
    tt.loaded = true
    // 与缓存完全一致时不重绘，避免打断正在浏览的歌单
    const same = fromCache && cached.length === fresh.length && cached[0] && cached[0].id === fresh[0].id
    if (!same) {
      tt.songs = fresh.map((song) => ({ ...song, vendor: 'netease' }))
      tt.index = 0
      if (state.view === 'music') render()
    }
  } else if (!fromCache) {
    // 加载失败自动重试（最多 3 次），期间保持加载态，用户不用手动点「重新加载」
    tt.loadRetry = (tt.loadRetry || 0) + 1
    if (tt.loadRetry <= 3) {
      tt.loaded = false
      window.setTimeout(() => {
        if (tt.loading || tt.songs.length) return
        ttLoadChart()
      }, 1200 * tt.loadRetry)
    } else {
      tt.loaded = true
      tt.error = (result && result.error) || '网易云热歌榜加载失败，请检查网络后重试'
    }
    if (state.view === 'music') render()
  }
}

/* 启动时后台预取榜单，进音乐厅时直接命中缓存 */
function ttPrefetchChart() {
  const tt = ttSlot()
  if (tt.loaded || tt.loading || tt.songs.length) return
  tt.loading = true
  bridge.neteaseChart({ id: TT_CHART_ID })
    .then((result) => {
      tt.loading = false
      if (tt.loaded) return
      if (result && Array.isArray(result.list) && result.list.length) {
        tt.songs = result.list.map((song) => ({ ...song, vendor: 'netease' }))
        tt.index = 0
        tt.loaded = true
        if (state.view === 'music') render()
      }
    })
    .catch(() => {
      tt.loading = false
    })
}

async function ttMiguSearch(keyword) {
  const tt = ttSlot()
  const query = String(keyword || '').trim()
  if (!query || tt.loading) return
  ttToolsHold()
  tt.vendor = 'migu'
  tt.query = query
  tt.searchMode = false
  tt.loading = true
  tt.error = ''
  if (state.view === 'music') render()
  let result = null
  try {
    result = await bridge.miguSearch({ keyword: query })
  } catch {
    result = null
  }
  tt.loading = false
  tt.loaded = true
  if (result && Array.isArray(result.list) && result.list.length) {
    tt.songs = result.list.map((song) => ({ ...song, vendor: 'migu' }))
    tt.index = 0
    tt.currentId = ''
  } else {
    tt.songs = []
    tt.index = 0
    tt.error = (result && result.error) || `咪咕音乐没有找到「${query}」相关歌曲`
  }
  ttToolsSearchEnd()
  if (state.view === 'music') render()
}

function ttLoadVendor(vendor) {
  const tt = ttSlot()
  if (tt.loading) return
  if (vendor === 'migu') {
    const query = tt.query || '热门'
    tt.vendor = 'migu'
    tt.query = query
    ttMiguSearch(query)
  } else {
    ttLoadChart()
  }
}

/**
 * 歌曲搜索：直接搜各音乐网站（咪咕 + 网易云），结果合并去重。
 * - 只保留 3 分钟以上的完整歌曲
 * - 列表不显示歌曲来源，只显示歌名
 */
async function ttSearch(keyword) {
  const tt = ttSlot()
  const query = String(keyword || '').trim()
  if (!query || tt.loading) return
  ttToolsHold()
  tt.vendor = 'web'
  tt.query = query
  tt.searchMode = true
  tt.loading = true
  tt.error = ''
  if (state.view === 'music') render()

  const run = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch((err) => ({ list: [], error: String((err && err.message) || err || '请求失败') }))
  const [miguResult, neteaseResult] = await Promise.all([
    run(() => bridge.miguSearch({ keyword: query, limit: 60 })),
    run(() => bridge.neteaseSearch({ keyword: query, limit: 60 }))
  ])

  const seen = new Set()
  const songs = []
  const push = (song) => {
    let duration = Number(song.duration) || 0
    // 兼容以「秒」返回时长的接口（咪咕）
    if (duration > 0 && duration < 10000) duration *= 1000
    if (duration < 180000) return
    const key = String(song.title || '').replace(/\s+/g, '').toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    songs.push({ ...song, duration })
  }
  const miguList = miguResult && Array.isArray(miguResult.list) ? miguResult.list : []
  const neteaseList = neteaseResult && Array.isArray(neteaseResult.list) ? neteaseResult.list : []
  miguList.forEach((song) => push({ ...song, vendor: 'migu' }))
  neteaseList.forEach((song) => push({ ...song, vendor: 'netease' }))

  tt.loading = false
  tt.loaded = true
  tt.songs = songs
  tt.index = 0
  tt.currentId = ''
  if (!songs.length) {
    const reasons = []
    if (miguResult && miguResult.error) reasons.push(`咪咕 ${miguResult.error}`)
    if (neteaseResult && neteaseResult.error) reasons.push(`网易云 ${neteaseResult.error}`)
    tt.error = reasons.length
      ? `搜索失败：${reasons.join('；')}`
      : `没有找到「${query}」3 分钟以上的歌曲`
  }
  ttToolsSearchEnd()
  if (state.view === 'music') render()
}

function ensureTtLoaded() {
  const tt = ttSlot()
  if (!tt.loaded && !tt.loading) ttLoadChart()
  if (!tt.toplists.length && !tt.toplistsLoading) ttLoadToplists()
}

async function ttLoadToplists() {
  const tt = ttSlot()
  if (tt.toplistsLoading || tt.toplists.length) return
  tt.toplistsLoading = true
  if (state.view === 'music') render()
  try {
    const result = await bridge.neteaseToplists()
    tt.toplists = result && Array.isArray(result.list) ? result.list : []
  } catch {
    tt.toplists = []
  }
  tt.toplistsLoading = false
  if (state.view === 'music') render()
}

function ttNeteaseTracks(list) {
  return (list || []).map((song) => ({
    vendor: 'netease',
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album || '',
    duration: song.duration || 0,
    url: `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`,
    source: '网易云'
  }))
}

async function ttLoadToplist(id, name) {
  const tt = ttSlot()
  tt.error = ''
  tt.query = ''
  tt.searchMode = false
  tt.panel = 'list'
  const cached = ttChartCacheGet(id)
  if (cached.length) {
    // 命中缓存直接显示，后台再刷新
    tt.songs = ttNeteaseTracks(cached)
    tt.index = 0
    tt.loaded = true
    tt.loading = false
    if (state.view === 'music') render()
  } else {
    tt.loading = true
    tt.loaded = false
    if (state.view === 'music') render()
  }
  try {
    const result = await bridge.neteaseChart({ id })
    if (result && Array.isArray(result.list) && result.list.length) {
      const same = cached.length === result.list.length && cached[0] && cached[0].id === result.list[0].id
      if (!same) {
        tt.songs = ttNeteaseTracks(result.list)
        tt.index = 0
      }
      tt.loaded = true
    } else if (!cached.length) {
      tt.error = (result && result.error) || '加载歌单失败'
    }
  } catch (err) {
    if (!cached.length) tt.error = String(err && err.message ? err.message : err) || '加载歌单失败'
  }
  tt.loading = false
  if (state.view === 'music') render()
  if (tt.songs.length) toast(`已载入「${name || '热门歌单'}」${tt.songs.length} 首`)
}

function formatPlayCount(n) {
  const v = Number(n) || 0
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)} 亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)} 万`
  return String(v)
}

const TT_MODES = [
  { id: 'order', label: '顺序' },
  { id: 'loop', label: '列表循环' },
  { id: 'single', label: '单曲循环' }
]

function ttModeInfo(mode) {
  return TT_MODES.find((item) => item.id === mode) || TT_MODES[0]
}

function ttFormatTime(seconds) {
  const total = Number(seconds) || 0
  if (!total) return '00:00'
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(Math.floor(total % 60)).padStart(2, '0')}`
}

function ttEnsureAudio() {
  if (ttAudioBound) return
  ttAudioBound = true
  ttAudio.addEventListener('timeupdate', ttSyncUi)
  ttAudio.addEventListener('play', ttSyncUi)
  ttAudio.addEventListener('pause', ttSyncUi)
  ttAudio.addEventListener('playing', () => {
    ttSlot().failStreak = 0
  })
  ttAudio.addEventListener('error', () => {
    if (!ttAudio.src) return
    const tt = ttSlot()
    const track = ttActiveList()[tt.index]
    if (track && track.source === '网易云' && !track.miguTried) {
      track.miguTried = true
      ttFallbackMigu(track)
      return
    }
    tt.failStreak = (Number(tt.failStreak) || 0) + 1
    if (tt.failStreak >= 8) {
      tt.failStreak = 0
      toast('连续多首歌曲无法播放，可能是版权限制，请搜索其他歌曲')
      ttSyncUi()
      return
    }
    setTimeout(() => ttStep(1), 150)
  })
  ttAudio.addEventListener('ended', () => {
    const tt = ttSlot()
    if (tt.mode === 'single') {
      ttAudio.currentTime = 0
      ttAudio.play().catch(() => {})
      return
    }
    const list = ttActiveList()
    if (tt.mode === 'order' && tt.index >= list.length - 1) {
      ttSyncUi()
      return
    }
    ttStep(1)
  })
}

function ttPlay(index) {
  const list = ttActiveList()
  if (!list.length) {
    toast('播放列表里还没有歌曲')
    return
  }
  const tt = ttSlot()
  const target = Math.max(0, Math.min(Number(index) || 0, list.length - 1))
  const track = list[target]
  if (!track) return
  tt.index = target
  tt.currentId = track.id
  tt.playingSong = track.song || null
  ttEnsureAudio()
  if (track.failed) {
    tt.failStreak = (Number(tt.failStreak) || 0) + 1
    if (tt.failStreak >= 8) {
      tt.failStreak = 0
      toast('连续多首歌曲无法播放，请换一首歌')
      ttSyncUi()
      return
    }
    setTimeout(() => ttStep(1), 80)
    return
  }
  if (!track.url && track.migu) {
    ttResolveMigu(track)
    return
  }
  if (!track.url) {
    toast('该歌曲没有可用的播放地址')
    return
  }
  ttAudio.src = track.url
  ttAudio.play().catch(() => toast('音频播放失败，请稍后重试'))
  ensureTtLyric()
  if (state.view === 'music') render()
}

async function ttResolveMigu(track) {
  const tt = ttSlot()
  toast('正在获取咪咕音乐播放地址…')
  let result = null
  try {
    result = await bridge.miguUrl(track.migu)
  } catch {
    result = null
  }
  const song = track.song || tt.songs.find((entry) => entry.vendor === 'migu' && entry.id === track.migu.contentId)
  if (result && result.url) {
    track.url = result.url
    if (song) song.url = result.url
    ttAudio.src = result.url
    ttAudio.play().catch(() => toast('音频播放失败，请稍后重试'))
    ensureTtLyric()
    if (state.view === 'music') render()
    return
  }
  if (song) song.failed = true
  tt.failStreak = (Number(tt.failStreak) || 0) + 1
  if (tt.failStreak >= 8) {
    tt.failStreak = 0
    toast('连续多首歌曲无法播放，请换一首歌')
    ttSyncUi()
    return
  }
  toast(`${(result && result.error) || '该歌曲暂不可播放'}，自动切换下一首`)
  setTimeout(() => ttStep(1), 350)
}

async function ttFallbackMigu(track) {
  const tt = ttSlot()
  toast(`「${track.title}」在网易云暂无版权，正在咪咕音乐搜索…`)
  let result = null
  try {
    result = await bridge.miguSearch({ keyword: `${track.title} ${track.artist}`, limit: 20 })
  } catch {
    result = null
  }
  const list = result && Array.isArray(result.list) ? result.list : []
  if (!list.length) {
    tt.failStreak = (Number(tt.failStreak) || 0) + 1
    if (tt.failStreak >= 8) {
      tt.failStreak = 0
      toast('连续多首歌曲无法播放，请换一首歌')
      ttSyncUi()
      return
    }
    toast('咪咕也没有找到，自动切换下一首')
    setTimeout(() => ttStep(1), 200)
    return
  }
  const cand = list[0]
  let urlRes = null
  try {
    urlRes = await bridge.miguUrl({
      contentId: cand.id,
      copyrightId: cand.copyrightId || '',
      resourceType: cand.resourceType || '2'
    })
  } catch {
    urlRes = null
  }
  if (urlRes && urlRes.url) {
    track.url = urlRes.url
    track.source = '咪咕音乐'
    if (track.song) {
      track.song.url = urlRes.url
      track.song.vendor = 'migu'
      track.song.id = cand.id
      track.song.copyrightId = cand.copyrightId || ''
      track.song.resourceType = cand.resourceType || '2'
    }
    ttAudio.src = urlRes.url
    ttAudio.play().catch(() => toast('音频播放失败，请稍后重试'))
    ensureTtLyric()
    if (state.view === 'music') render()
    return
  }
  tt.failStreak = (Number(tt.failStreak) || 0) + 1
  if (tt.failStreak >= 8) {
    tt.failStreak = 0
    toast('连续多首歌曲无法播放，请换一首歌')
    ttSyncUi()
    return
  }
  toast('咪咕暂无该曲播放地址，自动切换下一首')
  setTimeout(() => ttStep(1), 200)
}

function ttToggle() {
  const list = ttActiveList()
  if (!list.length) return
  if (!ttAudio.src) {
    ttPlay(ttSlot().index)
    return
  }
  if (ttAudio.paused) {
    ttAudio.play().catch(() => toast('音频播放失败，请稍后重试'))
  } else {
    ttAudio.pause()
  }
  ttSyncUi()
}

function ttStep(step) {
  const list = ttActiveList()
  if (!list.length) return
  const tt = ttSlot()
  const base = Number(tt.index) || 0
  let next = base + step
  if (next < 0) next = list.length - 1
  if (next >= list.length) next = 0
  ttPlay(next)
}

function ttSyncUi() {
  const playBtn = document.getElementById('ttPlayBtn')
  if (!playBtn) return
  playBtn.textContent = ttAudio.paused ? '播放' : '暂停'
  const cur = document.getElementById('ttCur')
  const dur = document.getElementById('ttDur')
  const fill = document.getElementById('ttProgressFill')
  const current = Number(ttAudio.currentTime) || 0
  const duration = Number(ttAudio.duration) || 0
  if (cur) cur.textContent = ttFormatTime(current)
  if (dur) dur.textContent = ttFormatTime(duration)
  if (fill) fill.style.width = duration ? `${Math.min(100, (current / duration) * 100)}%` : '0%'
  ttSyncLyric(current)
  if (ttLyricMode() === 'motion') ttStartMotion()
}

function ttRowHtml(track, index, activeIndex) {
  const song = track.song
  const key = song ? escapeHtml(ttSongKey(song)) : ''
  const liked = ttIsFavorite(song)
  const tools = song
    ? `<button class="tt-like${liked ? ' liked' : ''}" data-action="tt-like" data-key="${key}" title="${
        liked ? '取消喜欢' : '喜欢'
      }">♥</button>
        <button class="tt-add" data-action="tt-add" data-key="${key}" title="添加到我的歌单">＋</button>`
    : ''
  const metaLine = ttSlot().searchMode
    ? ''
    : `<span class="tt-artist">${escapeHtml(track.artist)} · ${escapeHtml(track.source)}</span>`
  return `<div class="tt-row${index === activeIndex ? ' active' : ''}" data-action="tt-pick" data-index="${index}">
    <span class="tt-rank">${index + 1}</span>
    <span class="tt-info">
      <span class="tt-title-line">
        <span class="tt-title">${escapeHtml(track.title)}</span>
        ${tools}
      </span>
      ${metaLine}
    </span>
  </div>`
}

/* 歌名放不下时拆成两份，配合 CSS 动画做横向循环滚动。
   先把所有宽度测量一次（只触发一次重排），再统一改 DOM，
   避免在循环里「改一次 DOM 再读一次布局」造成的连续重排卡顿。 */
function applyTitleMarquee(root) {
  const targets = root.querySelectorAll('.tt-title')
  if (!targets.length) return
  const measure = []
  for (let i = 0; i < targets.length; i += 1) {
    const el = targets[i]
    if (el.querySelector('.gy-title-track')) continue
    const text = (el.textContent || '').trim()
    if (!text) continue
    measure.push({ el, text, overflow: el.scrollWidth > el.clientWidth + 2 })
  }
  for (let i = 0; i < measure.length; i += 1) {
    const { el, text, overflow } = measure[i]
    if (!overflow) continue
    el.classList.add('gy-title-marquee')
    el.textContent = ''
    const track = document.createElement('span')
    track.className = 'gy-title-track'
    track.style.setProperty('--gy-title-duration', `${Math.max(9, text.length * 0.4)}s`)
    for (let j = 0; j < 2; j += 1) {
      const part = document.createElement('span')
      part.className = 'gy-title-part'
      part.textContent = text
      track.appendChild(part)
    }
    el.appendChild(track)
  }
}

/* 手指按下/滑动期间暂停歌名滚动动画，降低低端机合成压力（竖屏列表最明显），
   松开约 0.2 秒后自动恢复 */
;(function bindMarqueePause() {
  const body = document.body
  if (!body || body.dataset.marqueePauseBound === '1') return
  body.dataset.marqueePauseBound = '1'
  let timer = 0
  const hold = () => {
    clearTimeout(timer)
    body.classList.add('gy-marquee-paused')
  }
  const release = () => {
    clearTimeout(timer)
    timer = setTimeout(() => body.classList.remove('gy-marquee-paused'), 200)
  }
  ;['pointerdown', 'touchstart'].forEach((type) =>
    document.addEventListener(type, hold, { passive: true, capture: true })
  )
  ;['pointerup', 'pointercancel', 'touchend', 'touchcancel'].forEach((type) =>
    document.addEventListener(type, release, { passive: true, capture: true })
  )
})()

function renderTtPlayer(slot) {
  const tt = ttSlot()
  if (!tt.loaded && !tt.loading) ensureTtLoaded()
  const lyric = ttLyricSlot()
  if (tt.playingSong) ensureTtLyric()
  const panel = tt.panel || 'list'
  const lib = musicLibData()
  const panelTabs = (active) =>
    `<div class="tt-panel-tabs">
      <button class="tt-panel-tab${active === 'list' ? ' active' : ''}" data-action="tt-panel" data-panel="list">播放列表</button>
      <button class="tt-panel-tab${active === 'fav' ? ' active' : ''}" data-action="tt-panel" data-panel="fav">我喜欢</button>
      <button class="tt-panel-tab${active === 'pl' ? ' active' : ''}" data-action="tt-panel" data-panel="pl">我的歌单</button>
      <button class="tt-panel-tab${active === 'top' ? ' active' : ''}" data-action="tt-panel" data-panel="top">热门歌单</button>
    </div>`
  const list = ttActiveList()
  if (tt.currentId) {
    const found = list.findIndex((track) => track.id === tt.currentId)
    if (found >= 0) tt.index = found
  }
  const current = list[tt.index] || null
  const mode = ttModeInfo(tt.mode).label
  const playing = !ttAudio.paused && ttAudio.src
  const duration = Number(ttAudio.duration) || 0
  const position = Number(ttAudio.currentTime) || 0
  const vendor = tt.vendor === 'migu' ? 'migu' : 'netease'
  const rows = list.map((track, index) => ttRowHtml(track, index, tt.index)).join('')

  const lyricMode = ttLyricMode()
  const modeChips = TT_LYRIC_MODES.filter((item) => item.id !== 'motion')
    .map(
      (item) =>
        `<button class="tt-lyric-mode${item.id === lyricMode ? ' active' : ''}" data-action="tt-lyric-mode" data-mode="${
          item.id
        }">${item.label}</button>`
    )
    .join('')

  let lyricBody
  if (lyricMode === 'motion') {
    // 动感频谱已移到音量条下方，歌词区不再渲染
    lyricBody = ''
  } else if (!tt.playingSong) {
    lyricBody = '<div class="tt-lyric-empty">播放歌曲后显示歌词</div>'
  } else if (lyric.loading) {
    lyricBody = '<div class="tt-lyric-empty"><span class="spinner"></span>正在加载歌词…</div>'
  } else if (lyric.lines.length) {
    if (lyricMode === 'single' || lyricMode === 'ktv') {
      lyricBody = `<div class="tt-lyric-stage" id="ttLyricStage" data-active="${
        lyric.active
      }">${ttLyricStageHtml(lyric, lyric.active, lyricMode)}</div>`
    } else {
      lyricBody = lyric.lines
        .map((line, index) => {
          const tr =
            lyricMode === 'trans' ? lyric.trMap[Math.round(line.time * 10) / 10] : ''
          return `<div class="tt-lyric-line${index === lyric.active ? ' active' : ''}">${escapeHtml(
            line.text
          )}${tr ? `<span class="tt-lyric-tr">${escapeHtml(tr)}</span>` : ''}</div>`
        })
        .join('')
    }
  } else {
    lyricBody = `<div class="tt-lyric-empty">${escapeHtml(lyric.error || '暂无歌词')}</div>`
  }

  const sources = `<div class="tt-sources">
      <button class="tt-source${vendor === 'netease' ? ' active' : ''}" data-action="tt-vendor" data-vendor="netease">网易云音乐</button>
      <button class="tt-source${vendor === 'migu' ? ' active' : ''}" data-action="tt-vendor" data-vendor="migu">咪咕音乐</button>
    </div>`

  const search = `<form class="tt-search" id="ttForm">
      <input id="ttKeyword" type="search" enterkeyhint="search" placeholder="搜索歌曲或歌手，如：晴天" value="${escapeHtml(tt.query)}" />
      <button type="button" class="tt-search-btn" data-action="tt-search-do">搜索</button>
      ${
        vendor === 'netease'
          ? '<button type="button" class="tt-search-btn ghost" data-action="tt-chart">热歌榜</button>'
          : ''
      }
    </form>`

  const renaming = tt.renaming || ''
  const renForm = (playlist) =>
    renaming === playlist.id
      ? `<form class="tt-ren" id="ttRenForm" data-pid="${playlist.id}"><input name="name" value="${escapeHtml(
          playlist.name
        )}" /><button type="submit" class="tt-search-btn">保存</button></form>`
      : ''

  let panelHead = ''
  let panelBody = ''
  if (panel === 'fav') {
    panelHead = `<div class="tt-playlist-head">
      ${panelTabs('fav')}
      <span class="tt-count">${list.length} 首</span>
    </div>`
    panelBody = `<div class="tt-rows">${
      rows || '<div class="tt-empty">还没有喜欢的歌曲，点歌名后的 ♥ 收藏</div>'
    }</div>`
  } else if (panel === 'pl' && !tt.openPlaylist) {
    panelHead = `<div class="tt-playlist-head">
      ${panelTabs('pl')}
      <span class="tt-count">${lib.playlists.length} 个歌单</span>
    </div>`
    const playlistRows = lib.playlists
      .map((playlist) => {
        return `<div class="tt-pl-row" data-action="tt-open-pl" data-pid="${playlist.id}">
          <span class="tt-pl-name">${escapeHtml(playlist.name)}</span>
          <span class="tt-pl-count">${playlist.songs.length} 首</span>
          <button class="tt-mini" data-action="tt-rename-start" data-pid="${playlist.id}">重命名</button>
          <button class="tt-mini danger" data-action="tt-del-pl" data-pid="${playlist.id}">删除</button>
        </div>${renForm(playlist)}`
      })
      .join('')
    panelBody = `<div class="tt-pl-head"><button class="tt-search-btn" data-action="tt-new-pl">＋ 新建歌单</button></div>
      <div class="tt-rows tt-pl-list">${
        playlistRows || '<div class="tt-empty">还没有歌单，点上方按钮新建</div>'
      }</div>`
  } else if (panel === 'pl' && tt.openPlaylist) {
    const playlist = lib.playlists.find((item) => item.id === tt.openPlaylist)
    panelHead = `<div class="tt-playlist-head">
      ${panelTabs('pl')}
      <span class="tt-count">${playlist ? playlist.songs.length : 0} 首</span>
    </div>`
    panelBody = `<div class="tt-pl-head">
        <button class="tt-search-btn ghost" data-action="tt-back-pl">← 返回我的歌单</button>
        <span class="tt-pl-title">${escapeHtml(playlist ? playlist.name : '歌单不存在')}</span>
        ${
          playlist
            ? `<button class="tt-search-btn ghost" data-action="tt-rename-start" data-pid="${playlist.id}">重命名</button>`
            : ''
        }
      </div>
      ${playlist ? renForm(playlist) : ''}
      <div class="tt-rows">${rows || '<div class="tt-empty">这个歌单还是空的</div>'}</div>`
  } else if (panel === 'top') {
    panelHead = `<div class="tt-playlist-head">
      ${panelTabs('top')}
      <span class="tt-count">${tt.toplists.length} 个榜单</span>
    </div>`
    let topBody = ''
    if (tt.toplistsLoading && !tt.toplists.length) {
      topBody = '<div class="tt-empty"><span class="spinner"></span>正在加载热门歌单…</div>'
    } else if (!tt.toplists.length) {
      topBody = '<div class="tt-empty">暂无热门歌单<button class="tt-search-btn" data-action="tt-reload-top">重新加载</button></div>'
    } else {
      topBody = `<div class="tt-top-grid">${tt.toplists
        .map(
          (item) => `<div class="tt-top-card" data-action="tt-top-list" data-id="${item.id}" data-name="${escapeHtml(
            item.name
          )}">
          <div class="tt-top-cover" style="background-image:url('${escapeHtml(item.cover)}')">
            <span class="tt-top-play">${formatPlayCount(item.playCount)}</span>
          </div>
          <div class="tt-top-name">${escapeHtml(item.name)}</div>
        </div>`
        )
        .join('')}</div>`
    }
    panelBody = `<div class="tt-rows tt-top-rows">${topBody}</div>`
  } else {
    panelHead = `<div class="tt-playlist-head">
      ${panelTabs('list')}
    </div>`
    let rowsBody = rows
    if (tt.loading) {
      rowsBody = '<div class="tt-empty"><span class="spinner"></span>正在加载歌曲…</div>'
    } else if (!rows) {
      if (tt.error) {
        rowsBody = `<div class="tt-empty">${escapeHtml(tt.error)}<button class="tt-search-btn" data-action="tt-reload">重新加载</button></div>`
      } else {
        rowsBody = '<div class="tt-empty">播放列表为空，试试搜索一首歌（v1111d）</div>'
      }
    }
    panelBody = `${sources}${search}<div class="tt-rows">${rowsBody}</div>`
  }

  let picker = ''
  if (tt.picker && tt.picker.key) {
    const pickerSong = ttFindSongByKey(tt.picker.key)
    picker = `<div class="tt-picker">
      <div class="tt-picker-head">
        <span>添加到我的歌单${pickerSong ? `：${escapeHtml(pickerSong.title)}` : ''}</span>
        <button class="tt-mini" data-action="tt-picker-close">×</button>
      </div>
      <div class="tt-picker-list">
        ${lib.playlists
          .map(
            (playlist) =>
              `<button class="tt-picker-item" data-action="tt-add-to" data-pid="${playlist.id}">${escapeHtml(
                playlist.name
              )}<span>${playlist.songs.length} 首</span></button>`
          )
          .join('')}
        ${lib.playlists.length ? '' : '<div class="tt-empty">还没有歌单，在下面新建一个</div>'}
      </div>
      <form class="tt-newpl" id="ttNewPlForm">
        <input name="name" placeholder="新建歌单名称" />
        <button type="submit" class="tt-search-btn">新建并添加</button>
      </form>
    </div>`
  }

  if (lyricMode === 'motion') {
    setTimeout(ttStartMotion, 60)
    setTimeout(() => ttShowMotionName(2200), 60)
  }
  if (lyricMode === 'ktv') {
    setTimeout(() => {
      const ktvStage = document.getElementById('ttLyricStage')
      if (ktvStage) applyKtvScroll(ktvStage)
    }, 30)
  }

  const motionSlot =
    lyricMode === 'motion' ? `<div class="tt-motion-slot">${ttMotionHtml()}</div>` : ''

  const toolsBar = `<div class="tt-tools-bar">
      <span class="tt-tools-title">${
        panel === 'fav' ? '我喜欢' : panel === 'pl' ? '我的歌单' : panel === 'top' ? '热门歌单' : '播放列表'
      }</span>
      <button class="tt-mini tt-tools-toggle" data-action="tt-tools-toggle">${
        tt.toolsOpen ? '收起搜索' : '搜索'
      }</button>
    </div>`

  return `<div class="tt-wrap${lyricMode === 'motion' ? ' gy-motion' : ''}">
    <div class="tt-window${playing ? ' playing' : ''}">
      <div class="tt-bar">
        <span class="tt-mark">♪</span>
        <strong>晴晴音阁</strong>
      </div>
      <div class="tt-body">
        <div class="tt-player">
          <div class="tt-display">
            <span class="tt-now-title">${current ? escapeHtml(current.title) : '未选择歌曲'}</span>
            <span class="tt-now-artist">${current ? escapeHtml(current.artist) : '从右侧播放列表中选择一首'}</span>
          </div>
          <div class="tt-seek-row">
            <span class="tt-time" id="ttCur">${ttFormatTime(position)}</span>
            <div class="tt-progress" id="ttProgress"><div class="tt-progress-fill" id="ttProgressFill" style="width:${
              duration ? Math.min(100, (position / duration) * 100) : 0
            }%"></div></div>
            <span class="tt-time" id="ttDur">${ttFormatTime(duration)}</span>
          </div>
          <div class="tt-control-row">
            <div class="tt-controls">
              <button class="tt-btn" data-action="tt-prev">上一首</button>
              <button class="tt-btn tt-toggle" data-action="tt-play" id="ttPlayBtn">${ttAudio.paused ? '播放' : '暂停'}</button>
              <button class="tt-btn" data-action="tt-next">下一首</button>
            </div>
            <div class="tt-modes">
              ${TT_MODES.map((m) => `<button class="tt-mode-btn${tt.mode === m.id ? ' active' : ''}" data-action="tt-set-mode" data-mode="${m.id}">${m.label}</button>`).join('')}
            </div>
            <div class="tt-volume">
              <button class="tt-vol-btn${ttAudio.volume === 0 ? ' muted' : ''}" data-action="tt-mute" id="ttMuteBtn" title="静音/恢复">${ttAudio.volume > 0 ? TT_VOL_ON : TT_VOL_OFF}</button>
              <input class="tt-vol-range" id="ttVolumeRange" type="range" min="0" max="1" step="0.01" value="${ttAudio.volume}" aria-label="音量" />
              <span class="tt-vol-num" id="ttVolNum">${Math.round(ttAudio.volume * 100)}%</span>
            </div>
          </div>
          <div class="tt-lyric-bar">
            <span class="tt-lyric-label">歌词 · ${TT_LYRIC_MODES.find((item) => item.id === lyricMode).label}模式</span>
            <div class="tt-lyric-actions">
              <button class="tt-lyric-motion${lyricMode === 'motion' ? ' active' : ''}" data-action="tt-lyric-mode" data-mode="motion">动感</button>
              <div class="tt-lyric-modes">${modeChips}</div>
            </div>
          </div>
          ${motionSlot}
          ${
            lyricMode === 'motion'
              ? ''
              : `<div class="tt-lyrics" id="ttLyric">${lyricBody}</div>`
          }
        </div>
        <div class="tt-playlist${tt.toolsOpen ? '' : ' tools-hidden'}">
          ${toolsBar}
          ${picker}
          ${panelHead}
          ${panelBody}
        </div>
      </div>
    </div>
  </div>`
}

function animeSortedList(slot) {
  const yearOf = (item) => Number(item.year) || 0
  const list = slot.results.slice()
  if (slot.sort === 'new') {
    return list.sort((a, b) => {
      const ua = a.updated || ''
      const ub = b.updated || ''
      if (ua && ub && ua !== ub) return ub.localeCompare(ua)
      return yearOf(b) - yearOf(a)
    })
  }
  if (slot.sort === 'default') return list
  return list.sort((a, b) => (b.hot || 0) - (a.hot || 0) || yearOf(b) - yearOf(a))
}

function renderAnimeCategory(conf, slot) {
  const list = animeSortedList(slot)
  const sorts = [
    { id: 'hot', label: '热门' },
    { id: 'new', label: '最新' },
    { id: 'default', label: '默认' }
  ]
  const chips = sorts
    .map(
      (item) =>
        `<button class="music-chip cc-sort${(slot.sort || 'hot') === item.id ? ' active' : ''}" data-action="anime-sort" data-sort="${item.id}">${item.label}</button>`
    )
    .join('')
  let body = ''
  if (!slot.results.length && slot.loading) {
    body = `<div class="loading-note"><span class="spinner"></span>正在加载${conf.title}…</div>`
  } else if (!slot.results.length) {
    const tip = slot.error || '暂未找到相关片源，可在设置里添加更多搜索源后重试。'
    body = `<div class="folder-empty">${tip}<div class="anime-more"><button class="music-chip" data-action="anime-reload">重新加载</button></div></div>`
  } else {
    body = `<div class="grid">${list.map(webCardHtml).join('')}</div>`
  }
  const more = slot.hasMore
    ? `<div class="anime-more"><button class="music-chip" data-action="anime-more">${
        slot.loading ? '正在加载…' : '加载更多'
      }</button></div>`
    : slot.results.length
      ? `<div class="anime-more">已加载全部 ${slot.results.length} 个片源</div>`
      : ''
  return `<section class="section">
      <div class="cc-sorts">${chips}</div>
      ${body}
      ${more}
    </section>`
}

function maybeLoadMoreAnime() {
  if (state.view !== 'anime' || state.query) return
  const slot = categorySlot('anime')
  if (slot.loading || !slot.hasMore) return
  if (contentEl.scrollHeight > contentEl.clientHeight + 10) {
    if (contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - 320) {
      loadAnimePage((slot.page || 0) + 1)
      return
    }
  }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 320) {
    loadAnimePage((slot.page || 0) + 1)
  }
}

contentEl.addEventListener('scroll', maybeLoadMoreAnime, { passive: true })
window.addEventListener('scroll', maybeLoadMoreAnime, { passive: true })

function maybeLoadMoreMovies() {
  if (state.view !== 'online' || state.query) return
  const slot = movieSlot(state.movieGenre)
  if (!slot.loaded || slot.loading || !slot.hasMore) return
  if (contentEl.scrollHeight > contentEl.clientHeight + 10) {
    if (contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - 320) {
      loadMoviePage((slot.page || 0) + 1, state.movieGenre)
      return
    }
  }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 320) {
    loadMoviePage((slot.page || 0) + 1, state.movieGenre)
  }
}

contentEl.addEventListener('scroll', maybeLoadMoreMovies, { passive: true })
window.addEventListener('scroll', maybeLoadMoreMovies, { passive: true })

function renderCategory(view) {
  const conf = CATEGORY_VIEWS[view]
  const slot = categorySlot(view)
  if (view === 'music') return renderMusicCategory(conf, slot)
  if (view === 'anime') return renderAnimeCategory(conf, slot)
  let body = ''
  const searching = Boolean(slot.search)
  // 短剧视图：热门/最新排序标签（右侧）
  let sortTabs = ''
  if (view === 'drama') {
    sortTabs = `<div class="drama-sort">
      <button class="drama-sort-btn${slot.sort === 'hot' ? ' active' : ''}" data-action="drama-sort" data-sort="hot">热门</button>
      <button class="drama-sort-btn${slot.sort === 'latest' ? ' active' : ''}" data-action="drama-sort" data-sort="latest">最新</button>
    </div>`
  }
  if (slot.results.length) {
    body = `<div class="grid">${slot.results.map(webCardHtml).join('')}</div>`
    if (slot.loading) {
      body += `<div class="loading-note"><span class="spinner"></span>正在加载更多${conf.title}…</div>`
    }
  } else if (slot.loading) {
    body = `<div class="loading-note"><span class="spinner"></span>${
      searching ? `正在搜索「${escapeHtml(slot.search)}」…` : `正在加载${conf.title}…`
    }</div>`
  } else {
    body = `<div class="folder-empty">${
      searching ? `没有找到与「${escapeHtml(slot.search)}」相关的${conf.title}，可更换关键词。` : '暂未找到相关片源，可在设置里添加更多搜索源后重试。'
    }${
      view === 'drama' && !searching
        ? '<div style="margin-top:12px"><button class="btn ghost small" data-action="category-reload">重新加载</button></div>'
        : ''
    }</div>`
  }
  return `<section class="section">
      ${sortTabs}
      ${body}
    </section>`
}

/* ---------- 小说家渲染 ---------- */

function bookCardHtml(book) {
  const wordText = book.wordCountText || (book.wordCount ? `${(book.wordCount / 10000).toFixed(1)}万字` : '')
  return `<div class="book-card" data-book-id="${escapeHtml(book.id)}" data-action="open-book">
    <div class="book-cover">
      ${book.cover ? `<img src="${escapeHtml(book.cover)}" alt="${escapeHtml(book.title)}" loading="lazy" onerror="this.style.display='none'" />` : `<div class="book-cover-fallback">${escapeHtml(book.title.slice(0, 1))}</div>`}
    </div>
    <div class="book-info">
      <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
      <div class="book-meta">
        <span class="book-author">${escapeHtml(book.author || '佚名')}</span>
        ${book.cat ? `<span class="book-cat">${escapeHtml(book.cat)}</span>` : ''}
        ${wordText ? `<span class="book-words">${wordText}</span>` : ''}
        ${book.status ? `<span class="book-status">${escapeHtml(book.status)}</span>` : ''}
      </div>
      <div class="book-last" title="${escapeHtml(book.lastChapter)}">${escapeHtml(book.lastChapter || '暂无章节')}</div>
    </div>
  </div>`
}

function renderNovel() {
  const slot = state.books
  const tabs = NOVEL_CATEGORIES.map(
    (cat) =>
      `<button class="novel-cat${cat.id === slot.category ? ' active' : ''}" data-action="novel-category" data-cat="${cat.id}">${escapeHtml(cat.name)}</button>`
  ).join('')
  let body = ''
  const searching = Boolean(slot.search)
  if (slot.results.length) {
    body = `<div class="book-grid">${slot.results.map(bookCardHtml).join('')}</div>`
    if (slot.loading) body += `<div class="loading-note"><span class="spinner"></span>正在加载更多书籍…</div>`
  } else if (slot.loading) {
    body = `<div class="loading-note"><span class="spinner"></span>${
      searching ? `正在搜索「${escapeHtml(slot.search)}」…` : `正在加载书籍…`
    }</div>`
  } else {
    body = `<div class="folder-empty">${slot.error || '暂无书籍'}</div>`
  }
  return `<section class="section">
    <div class="novel-cats">${tabs}</div>
    ${body}
  </section>`
}

/* ---------- 书籍阅读器 ---------- */

function openBookReader(bookId) {
  const book = state.books.results.find((item) => item.id === bookId)
  if (!book) return
  state.bookReader = { book, loading: true, chapters: [], currentIndex: 0, content: '', error: '' }
  renderBookReader()
  loadBookChapters(bookId).then((chapters) => {
    if (!state.bookReader || state.bookReader.book.id !== bookId) return
    state.bookReader.chapters = chapters
    state.bookReader.loading = false
    if (chapters.length) {
      state.bookReader.currentIndex = 0
      readBookChapter(0)
    } else {
      state.bookReader.error = '暂无章节'
      renderBookReader()
    }
  })
}

async function readBookChapter(index) {
  if (!state.bookReader) return
  const chapters = state.bookReader.chapters
  if (index < 0 || index >= chapters.length) return
  state.bookReader.currentIndex = index
  state.bookReader.content = ''
  state.bookReader.loading = true
  state.bookReader.error = ''
  renderBookReader()
  const body = await loadBookChapterContent(chapters[index].link)
  if (!state.bookReader) return
  state.bookReader.loading = false
  state.bookReader.content = body || '（章节内容加载失败，请稍后重试）'
  renderBookReader()
}

function renderBookReader() {
  const reader = state.bookReader
  const readerEl = bookReaderEl
  if (!readerEl) return
  if (!reader) {
    readerEl.classList.add('hidden')
    readerEl.innerHTML = ''
    return
  }
  const { book, chapters, currentIndex, content, loading, error } = reader
  const chapter = chapters[currentIndex]
  const prevDisabled = currentIndex <= 0
  const nextDisabled = currentIndex >= chapters.length - 1
  readerEl.classList.remove('hidden')
  readerEl.innerHTML = `
    <div class="book-reader-top">
      <button class="icon-btn" data-action="book-close" title="返回 (Esc)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
      </button>
      <div class="book-reader-heading">
        <div class="book-reader-title">${escapeHtml(book.title)}</div>
        <div class="book-reader-sub">${escapeHtml(chapter ? chapter.title : '加载章节中…')}</div>
      </div>
      <div class="book-reader-tools">
        <button class="icon-btn text" data-action="book-prev" ${prevDisabled ? 'disabled' : ''} title="上一章">上一章</button>
        <button class="icon-btn text" data-action="book-next" ${nextDisabled ? 'disabled' : ''} title="下一章">下一章</button>
      </div>
    </div>
    <div class="book-reader-body">
      ${loading ? `<div class="loading-note"><span class="spinner"></span>正在加载章节内容…</div>` : ''}
      ${error ? `<div class="folder-empty">${escapeHtml(error)}</div>` : ''}
      ${!loading && content ? `<div class="book-content">${escapeHtml(content).replace(/\n/g, '<br />')}</div>` : ''}
    </div>
  `
}

function closeBookReader() {
  state.bookReader = null
  if (bookReaderEl) {
    bookReaderEl.classList.add('hidden')
    bookReaderEl.innerHTML = ''
  }
}

function loadThumbCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem('gyThumbs') || '')
    if (parsed && typeof parsed === 'object' && parsed.data) return parsed
  } catch {
    /* 忽略损坏缓存 */
  }
  return { data: {} }
}

const thumbCache = loadThumbCache()
const thumbQueue = []
let thumbActive = 0

function cachedThumb(url) {
  const entry = thumbCache.data[url]
  return entry ? entry.d : ''
}

function saveThumbCache() {
  const entries = Object.entries(thumbCache.data)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, 200)
  thumbCache.data = Object.fromEntries(entries)
  try {
    localStorage.setItem('gyThumbs', JSON.stringify(thumbCache))
  } catch {
    /* 存储超限时忽略 */
  }
}

const thumbFailed = new Set()
const brokenPics = new Set()

function pickWebPoster(pic, url) {
  if (pic && !brokenPics.has(pic)) return pic
  return cachedThumb(url)
}

function scheduleThumbRequests() {
  const urls = new Set()
  document.querySelectorAll('.card[data-thumb]').forEach((card) => {
    if (card.querySelector('.poster img')) return
    const url = decodeURIComponent(card.dataset.thumb)
    if (url && !thumbCache.data[url] && !thumbFailed.has(url)) urls.add(url)
  })
  urls.forEach((url) => {
    if (!thumbQueue.includes(url)) thumbQueue.push(url)
  })
  pumpThumbs()
}

function pumpThumbs() {
  while (thumbActive < 2 && thumbQueue.length) {
    const url = thumbQueue.shift()
    thumbActive++
    extractThumb(url)
      .then((dataURL) => {
        if (dataURL) {
          thumbCache.data[url] = { d: dataURL, t: Date.now() }
          saveThumbCache()
          render()
        } else {
          thumbFailed.add(url)
        }
      })
      .catch(() => thumbFailed.add(url))
      .finally(() => {
        thumbActive--
        pumpThumbs()
      })
  }
}

function extractThumb(url) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
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
    const isHls = /\.m3u8(?:[?#]|$)/i.test(url)
    const isDirectFile = /\.(mp4|webm|m4v|mov)(?:[?#]|$)/i.test(url)
    if (!isDirectFile && window.Hls && window.Hls.isSupported()) {
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

function onlineCardItem(item) {
  return {
    ...item,
    posterUrl: pickWebPoster(item.poster || item.posterUrl, item.url),
    thumbSrc: item.url || ''
  }
}

/* ---------- 渲染 ---------- */

function renderTopTabs() {
  const host = document.getElementById('musicTabs')
  if (!host) return
  const slot = categorySlot('music')
  const show = state.view === 'music' && !state.query
  host.classList.toggle('hidden', !show)
  if (!show) {
    host.innerHTML = ''
  } else {
    const source = ['web', 'cc', 'tt'].includes(slot.musicSource) ? slot.musicSource : 'tt'
    host.innerHTML = MUSIC_SOURCES.map(
      (entry) =>
        `<button class="topbar-tab${entry.key === source ? ' active' : ''}" data-action="music-source" data-source="${
          entry.key
        }">${entry.label}</button>`
    ).join('')
  }
  const searchBox = document.querySelector('.topbar > .search')
  if (searchBox) searchBox.classList.toggle('hidden', show)
  const actions = document.querySelector('.topbar-actions')
  if (actions) actions.classList.toggle('hidden', show)
}

function render() {
  rebuildWatchables()
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view)
  })
  document.querySelectorAll('.topbar-action').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view)
  })

  const scrollTop = contentEl.scrollTop
  const ttRowsEl = contentEl.querySelector('.tt-rows')
  const ttRowsScroll = ttRowsEl ? ttRowsEl.scrollTop : 0
  let html = ''
  if (state.query) html = renderSearch()
  else if (state.view === 'home') html = renderHome()
  else if (state.view === 'movies') html = renderMovies()
  else if (state.view === 'series') html = renderSeries()
  else if (state.view === 'online') html = renderOnline()
  else if (state.view === 'tv') html = renderTv()
  else if (state.view === 'novel') html = renderNovel()
  else if (CATEGORY_VIEWS[state.view]) html = renderCategory(state.view)
  else if (state.view === 'history') html = renderHistory()
  else if (state.view === 'searches') html = renderSearches()
  else if (state.view === 'settings') html = renderSettings()

  contentEl.innerHTML = html
  const lyricsFull = state.view === 'music' && !state.query && categorySlot('music').musicSource === 'tt'
  contentEl.classList.toggle('lyrics-full', lyricsFull)
  contentEl.classList.toggle('is-settings', state.view === 'settings' && !state.query)
  // 音乐厅隐藏顶栏放大镜，并把内容窗口上移到顶栏下沿
  document.body.classList.toggle('gy-music-view', state.view === 'music' && !state.query)
  contentEl.scrollTop = scrollTop
  const newTtRows = contentEl.querySelector('.tt-rows')
  if (newTtRows) newTtRows.scrollTop = ttRowsScroll
  if (lyricsFull) {
    // 放到下一帧再测量/重建歌名滚动，避免和按钮点击的重新渲染抢同一帧
    requestAnimationFrame(() => applyTitleMarquee(contentEl))
  }
  searchInput.placeholder =
    state.view === 'drama'
      ? '搜索Ai短剧'
      : state.view === 'novel'
        ? '搜索书名、作者'
        : '搜索影片名，全网电影剧集'
  renderTopTabs()
  if (state.view === 'tv' && !state.query) applyTvFilter()
  if (state.view === 'home' && !state.query) ensureMovieLoaded()
  if (state.view === 'music' && categorySlot('music').musicSource === 'tt') ttSyncUi()
  if (state.view === 'music' && !state.query) ttFitMusicWindowHeight()
  scheduleThumbRequests()
}

/* ---------- 详情 ---------- */

function posterShell(item, kind) {
  if (kind === 'series') {
    const seasons = new Map()
    for (const episode of item.episodes) {
      if (!seasons.has(episode.season)) seasons.set(episode.season, [])
      seasons.get(episode.season).push(episode)
    }
    const groups = [...seasons.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, episodes]) => {
        const heading = seasons.size > 1 ? `<h3>第 ${season} 季</h3>` : ''
        const rows = episodes
          .map((episode) => {
            const percent = progressPercent(episode.id)
            return `<button class="episode" data-action="detail-play-episode" data-series="${item.id}" data-episode="${episode.id}">
              <span class="ep-num">${pad2(episode.episode)}</span>
              <span class="ep-name">第 ${episode.episode} 集</span>
              ${percent > 0 && percent < 99 ? '<span class="ep-dot"></span>' : ''}
              ${episode.playable ? '' : '<span class="ep-tag">外部播放</span>'}
            </button>`
          })
          .join('')
        return `<div class="episode-group">${heading}<div class="episode-list">${rows}</div></div>`
      })
      .join('')

    return `<div class="detail-actions">
        <button class="btn primary" data-action="detail-play-series" data-series="${item.id}">▶ 播放第一集</button>
      </div>
      <div class="episode-groups">${groups}</div>`
  }

  if (kind === 'web') {
    if (!item.episodes.length) {
      return `<div class="detail-actions"><span class="hint">该资源暂无播放地址</span></div>`
    }
    const rows = item.episodes
      .map((ep, index) => {
        const percent = progressPercent(`${item.key}:${index}`)
        return `<button class="episode" data-action="web-play-ep" data-key="${escapeHtml(item.key)}" data-idx="${index}">
          <span class="ep-num">${pad2(index + 1)}</span>
          <span class="ep-name">${escapeHtml(ep.name || `第 ${index + 1} 集`)}</span>
          ${percent > 0 && percent < 99 ? '<span class="ep-dot"></span>' : ''}
        </button>`
      })
      .join('')
    return `<div class="detail-actions">
        <button class="btn primary" data-action="web-play" data-key="${escapeHtml(item.key)}">▶ 播放${
          item.episodes.length > 1 ? '第一集' : ''
        }</button>
      </div>
      <div class="episode-groups"><div class="episode-group"><div class="episode-list">${rows}</div></div></div>`
  }

  if (kind === 'online') {
    const removeBtn = isBuiltIn(item.id)
      ? ''
      : `<button class="btn ghost danger" data-action="delete-online" data-id="${item.id}">从片单移除</button>`
    return `<div class="detail-actions">
      <button class="btn primary" data-action="detail-play-online" data-id="${item.id}">▶ 播放</button>
      ${removeBtn}
    </div>`
  }

  return `<div class="detail-actions">
    <button class="btn primary" data-action="detail-play" data-id="${item.id}">▶ 播放</button>
    <button class="btn ghost" data-action="external" data-file="${escapeHtml(item.file)}">用系统播放器打开</button>
  </div>`
}

function detailHtml(kind, id) {
  let item = null
  let actions = ''
  let meta = ''
  let pathLine = ''

  if (kind === 'series') {
    item = state.library.series.find((entry) => entry.id === id)
    if (!item) return ''
    meta = [item.year ? String(item.year) : '', `全 ${item.episodes.length} 集`].filter(Boolean).join(' · ')
    pathLine = item.root
    actions = posterShell(item, 'series')
  } else if (kind === 'online') {
    item = allOnlineItems().find((entry) => entry.id === id)
    if (!item) return ''
    let host = ''
    try {
      host = new URL(item.url).host
    } catch {
      host = '在线'
    }
    meta = [item.year ? String(item.year) : '', item.genre || '', `在线播放 · ${host}`].filter(Boolean).join(' · ')
    pathLine = item.url
    actions = posterShell(item, 'online')
  } else if (kind === 'web') {
    item = state.webMap.get(id)
    if (!item) return ''
    meta = [item.year, item.type, item.remarks, `来源：${item.source}`].filter(Boolean).join(' · ')
    pathLine = `网络搜索源 · ${item.source}`
    actions = posterShell(item, 'web')
  } else {
    item = state.library.movies.find((entry) => entry.id === id)
    if (!item) return ''
    meta = [item.year ? String(item.year) : '', '电影', formatSize(item.size)].filter(Boolean).join(' · ')
    pathLine = item.file
    actions = posterShell(item, 'movie')
  }

  const thumbFallback =
    kind === 'web' && item.episodes && item.episodes.length
      ? cachedThumb(item.episodes[0].url)
      : kind === 'online' && item.url
        ? cachedThumb(item.url)
        : ''

  let displayPic = item.pic || item.posterUrl || item.poster || ''
  if ((kind === 'web' || kind === 'online') && displayPic && brokenPics.has(displayPic)) displayPic = ''

  const posterSrc = displayPic || thumbFallback || ''

  return `<div class="detail-card">
    ${posterSrc ? `<div class="detail-backdrop" style="background-image:url('${escapeHtml(posterSrc)}')"></div>` : ''}
    <button class="detail-close" data-action="close-detail">×</button>
    <div class="detail-content">
      <div class="detail-poster" style="${posterSrc ? '' : gradientFor(item.title)}">
        ${posterSrc ? `<img src="${escapeHtml(posterSrc)}" alt="" />` : `<span>${escapeHtml(item.title.charAt(0))}</span>`}
      </div>
      <div class="detail-main">
        <h2>${escapeHtml(item.title)}</h2>
        <div class="detail-meta">${escapeHtml(meta)}</div>
        ${pathLine ? `<div class="detail-path" title="${escapeHtml(pathLine)}">${escapeHtml(pathLine)}</div>` : ''}
        ${actions}
      </div>
    </div>
  </div>`
}

async function openDetail(kind, id) {
  if (kind === 'web') {
    const item = state.webMap.get(id)
    if (item && item.yh && (!item.episodes || !item.episodes.length)) {
      state.detail = { kind, id }
      detailEl.innerHTML = `<div class="detail-card"><div class="loading-note"><span class="spinner"></span>正在获取剧集…</div></div>`
      detailEl.classList.remove('hidden')
      const episodes = await yhEpisodes(item.vodId)
      if (episodes.length) item.episodes = episodes
      if (!state.detail || state.detail.id !== id) return
      const html = detailHtml(kind, id)
      if (html) detailEl.innerHTML = html
      return
    }
  }
  const html = detailHtml(kind, id)
  if (!html) return
  state.detail = { kind, id }
  detailEl.innerHTML = html
  detailEl.classList.remove('hidden')
  detailEl.querySelector('.detail-card').scrollTop = 0
}

function closeDetail() {
  state.detail = null
  detailEl.classList.add('hidden')
  detailEl.innerHTML = ''
}

/* ---------- 播放 ---------- */

function movieQueue(movie) {
  return [
    {
      id: movie.id,
      title: movie.title,
      label: movie.year ? String(movie.year) : '',
      meta: '电影',
      src: encodePath(movie.file),
      file: movie.file,
      subtitle: movie.subtitle
    }
  ]
}

function seriesQueue(series) {
  return series.episodes.map((episode) => ({
    id: episode.id,
    title: series.title,
    label: `第 ${episode.episode} 集`,
    meta: '剧集',
    src: encodePath(episode.file),
    file: episode.file,
    subtitle: episode.subtitle,
    playable: episode.playable
  }))
}

function playMovie(movie) {
  openPlayer(movieQueue(movie), 0)
}

function playEpisode(series, episodeId) {
  if (!series) return
  const queue = seriesQueue(series)
  let index = queue.findIndex((entry) => entry.id === episodeId)
  if (index < 0) index = 0
  openPlayer(queue, index)
}

function playOnline(item) {
  if (!item) return
  openPlayer(
    [
      {
        id: item.id,
        title: item.title,
        label: '',
        meta: '在线',
        src: item.url,
        file: null,
        subtitle: null
      }
    ],
    0
  )
}

async function playWeb(item, index = 0) {
  if (!item) return
  if (item.yh && (!item.episodes || !item.episodes.length)) {
    item.episodes = await yhEpisodes(item.vodId)
  }
  if (!item.episodes || !item.episodes.length) {
    toast('该影片暂时没有可播放的剧集')
    return
  }
  const queue = item.episodes.map((ep, i) => ({
    id: `${item.key}:${i}`,
    title: item.title,
    label: ep.name || `第 ${i + 1} 集`,
    meta: item.source || '网络',
    src: ep.url || '',
    // 同名动漫在其他片源的同一集，作为播放失败时的备用线路
    altSrcs: (item.alts || [])
      .map((alt) => {
        const altEp = (alt.episodes || [])[i]
        return altEp && altEp.url ? { source: alt.source, url: altEp.url } : null
      })
      .filter(Boolean),
    file: null,
    subtitle: null,
    posterUrl: item.pic || '',
    yh: !!item.yh,
    audio: !!item.audio,
    vodId: item.vodId,
    nid: ep.nid
  }))
  const idx = Math.min(Math.max(0, index), queue.length - 1)
  openPlayer(queue, idx)
}

function playById(id) {
  const item = state.watchables.get(id)
  if (!item) return
  if (item.kind === 'movie') {
    const movie = state.library.movies.find((entry) => entry.id === id)
    if (movie) playMovie(movie)
  } else if (item.kind === 'episode') {
    playEpisode(item.series, id)
  } else if (item.kind === 'online') {
    const online = allOnlineItems().find((entry) => entry.id === id)
    if (online) playOnline(online)
  }
}

const GY_PLATFORM =
  typeof window !== 'undefined' &&
  window.Capacitor &&
  typeof window.Capacitor.getPlatform === 'function'
    ? window.Capacitor.getPlatform()
    : ''
const IS_IOS = GY_PLATFORM === 'ios'
const TV_PROXY_ENABLED = GY_PLATFORM === 'android'
const TV_PROXY_BASE = (typeof window !== 'undefined' && window.location ? window.location.origin : '') || ''
let tvLoaderClass = null

function tvProxyUrl(url) {
  return `${TV_PROXY_BASE}/__gy/tv?u=${encodeURIComponent(url)}`
}

/**
 * 直播源基本都不返回 CORS 头，WebView 里 hls.js 直连会被拦。
 * 在安卓端把 hls.js 的每个请求改写成同源 /__gy/tv 代理地址，由原生转发并补上 CORS 头。
 */
function tvHlsLoader() {
  if (!TV_PROXY_ENABLED) return null
  if (tvLoaderClass) return tvLoaderClass
  const Hls = window.Hls
  const Base = Hls && Hls.DefaultConfig ? Hls.DefaultConfig.loader : null
  if (!Base) return null
  function ProxyLoader(config) {
    Base.call(this, config)
  }
  ProxyLoader.prototype = Object.create(Base.prototype)
  ProxyLoader.prototype.constructor = ProxyLoader
  ProxyLoader.prototype.load = function (context, config, callbacks) {
    if (!context || typeof context.url !== 'string' || !/^https?:/i.test(context.url)) {
      return Base.prototype.load.call(this, context, config, callbacks)
    }
    const realUrl = context.url
    const patched = Object.assign({}, context, { url: tvProxyUrl(realUrl) })
    // hls.js 用响应里的 responseURL 作为清单的 baseurl 去解析分片相对路径。
    // 走代理后 responseURL 会变成 /__gy/tv?...，必须还原成原始地址，否则分片请求全错。
    const wrapped = {
      onSuccess: function (response, stats, ctx, networkDetails) {
        if (response && typeof response === 'object' && response.url) response.url = realUrl
        return callbacks.onSuccess(response, stats, context, networkDetails)
      },
      onError: function (error, ctx, networkDetails) {
        return callbacks.onError(error, context, networkDetails)
      },
      onTimeout: function (ctx) {
        return callbacks.onTimeout(context)
      }
    }
    return Base.prototype.load.call(this, patched, config, wrapped)
  }
  tvLoaderClass = ProxyLoader
  return tvLoaderClass
}

/* 起播前先和媒体域名建连，省掉首次 DNS / TLS 往返 */
const gyPreconnected = new Set()
function preconnectMedia(url) {
  try {
    const parsed = new URL(String(url), window.location.href)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
    if (gyPreconnected.has(parsed.origin)) return
    gyPreconnected.add(parsed.origin)
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = parsed.origin
    link.crossOrigin = 'anonymous'
    document.head.appendChild(link)
  } catch (err) {
    /* 非法地址忽略 */
  }
}

/**
 * iOS 的 WKWebView 自带 HLS（AVPlayer），媒体元素也不受 CORS 限制，
 * 所以 iOS 直接交给原生播放 m3u8，不需要 hls.js 和 /__gy/tv 代理。
 * 这里只补上「卡住自动重连 + 线路切换」，与安卓端行为保持一致。
 */
function startNativeHls(item, src) {
  if (player.liveWatchdog) {
    clearInterval(player.liveWatchdog)
    player.liveWatchdog = null
  }
  player.hls = null
  player.lastSeekAt = 0
  player.seekStuckAt = 0
  player.stallAt = 0
  player.lastProgressTime = -1
  videoEl.src = src
  videoEl.play().catch(() => {})
  if (!item.tvUrls) return
  player.liveWatchdog = setInterval(() => {
    if (player.current !== item || !player.open) {
      clearInterval(player.liveWatchdog)
      player.liveWatchdog = null
      return
    }
    // 用户暂停时不算卡住
    if (videoEl.paused || videoEl.ended) return
    const now = Date.now()
    const t = videoEl.currentTime
    if (player.lastProgressTime < 0 || Math.abs(t - player.lastProgressTime) > 0.3) {
      player.lastProgressTime = t
      player.stallAt = 0
      return
    }
    if (!player.stallAt) {
      player.stallAt = now
      return
    }
    if (now - player.stallAt > 15000) {
      player.stallAt = 0
      switchTvLine(item)
    }
  }, 2000)
}

// 当前线路失败：还有备用线路就换下一条，否则报错
function switchTvLine(item) {
  if (!item || player.current !== item) return
  if (item.tvUrls && player.tvIndex < item.tvUrls.length - 1) {
    player.tvIndex += 1
    item.src = item.tvUrls[player.tvIndex]
    setPlayerSrc(item)
    return
  }
  showPlayerError()
}

function tvBufferedContains(t) {
  const b = videoEl.buffered
  for (let i = 0; i < b.length; i += 1) {
    if (t >= b.start(i) - 0.5 && t <= b.end(i) + 0.5) return true
  }
  return false
}

// 直播纠偏：目标点必须落在可 seek 区间内，且当前没有未完成的 seek。
// 反复叠加 seek 会让 MSE 永久卡在 seeking，表现为有画面但完全冻住。
// force=true 用于把已经卡在缓冲外/挂起 seek 的播放头强行拉回已缓冲边缘。
function tvSeekTo(t, force) {
  if (!Number.isFinite(t)) return false
  if (!force) {
    if (videoEl.seeking) return false
    if (Date.now() - (player.lastSeekAt || 0) < 1500) return false
  }
  const sk = videoEl.seekable
  let target = t
  if (sk && sk.length) {
    const lo = sk.start(sk.length - 1)
    const hi = sk.end(sk.length - 1)
    if (target > hi) target = Math.max(lo, hi - 0.5)
    if (target < lo) target = lo
  }
  if (Math.abs(target - videoEl.currentTime) < 0.2) return false
  player.lastSeekAt = Date.now()
  try {
    videoEl.currentTime = target
    return true
  } catch (err) {
    return false
  }
}

function setPlayerSrc(item) {
  const src = item.src
  preconnectMedia(src)
  videoEl.playbackRate = 1
  if (!src) {
    showPlayerError()
    return
  }
  const isHlsExt = /\.m3u8(?:[?#]|$)/i.test(src)
  const isDirectFile =
    /\.(mp4|webm|m4v|mov|ogv|m4a|mp3|flac|aac)(?:[?#]|$)/i.test(src) ||
    /mime_type=(audio|video)_(mp4|mpeg)/i.test(src)
  playerLoadingEl.classList.toggle('hidden', !/^https?:/i.test(src))
  // iOS：m3u8（含电视台直播）直接交给系统 HLS 播放器，避开 hls.js 的 CORS 限制
  if (IS_IOS && (isHlsExt || !!item.tvUrls)) {
    startNativeHls(item, src)
    return
  }
  if (isHlsExt || (!isDirectFile && window.Hls && window.Hls.isSupported())) {
    if (window.Hls && window.Hls.isSupported()) {
      const hlsConfig = item.tvUrls
        ? {
            enableWorker: true,
            lowLatencyMode: true,
            // 跳过启动测速：直接按估算带宽起播，少一轮探测往返
            testBandwidth: false,
            abrEwmaDefaultEstimate: 6000000,
            liveSyncDurationCount: 1,
            liveMaxLatencyDurationCount: 2,
            maxLiveSyncPlaybackRate: 2,
            backBufferLength: 2,
            maxBufferLength: 6,
            maxMaxBufferLength: 10,
            manifestLoadingTimeOut: 6000,
            fragLoadingTimeOut: 8000,
            fragLoadingMaxRetry: 3,
            manifestLoadingMaxRetry: 2,
            levelLoadingMaxRetry: 2
          }
        : {
            enableWorker: true,
            startFragPrefetch: true,
            // 点播同样跳过测速，尽早拿到第一个分片
            testBandwidth: false,
            abrEwmaDefaultEstimate: 8000000,
            manifestLoadingTimeOut: 8000,
            fragLoadingTimeOut: 10000,
            maxBufferLength: 120,
            maxMaxBufferLength: 600,
            maxBufferSize: 60 * 1000 * 1000,
            backBufferLength: 30,
            fragLoadingMaxRetry: 4,
            manifestLoadingMaxRetry: 3,
            levelLoadingMaxRetry: 4
          }
      const tvLoader = item.tvUrls ? tvHlsLoader() : null
      if (tvLoader) hlsConfig.loader = tvLoader
      player.hls = new window.Hls(hlsConfig)
      if (item.tvUrls) {
        player.lastSeekAt = 0
        player.seekStuckAt = 0
        player.stallAt = 0
        player.lastProgressTime = -1
        // MSE seek 卡死或播放停住时，销毁并重建 hls，从直播边缘重新拉流
        const recoverLive = () => {
          if (player.current !== item) return
          if (player.liveRecoveries >= 2 && item.tvUrls && player.tvIndex < item.tvUrls.length - 1) {
            player.tvIndex += 1
            item.src = item.tvUrls[player.tvIndex]
            player.liveRecoveries = 0
          } else if (player.liveRecoveries >= 4) {
            showPlayerError()
            return
          }
          player.liveRecoveries += 1
          if (player.liveWatchdog) {
            clearInterval(player.liveWatchdog)
            player.liveWatchdog = null
          }
          if (player.hls) {
            try {
              player.hls.destroy()
            } catch (err) {
              /* 忽略 */
            }
            player.hls = null
          }
          videoEl.pause()
          videoEl.removeAttribute('src')
          videoEl.load()
          player.lastSeekAt = 0
          player.seekStuckAt = 0
          player.stallAt = 0
          player.lastProgressTime = -1
          setPlayerSrc(item)
        }
        player.hls.on(window.Hls.Events.LEVEL_LOADED, () => {
          if (!player.hls || !Number.isFinite(player.hls.liveSyncPosition)) return
          const target = player.hls.liveSyncPosition
          // 只在目标点已经缓冲、且明显落后时才纠偏。绝不在初始化时跳到尚未缓冲的直播点：
          // 分片时间轴偏移的源会让 MSE seek 永远无法完成，表现为有画面但冻住。
          if (target - videoEl.currentTime > 2.5 && tvBufferedContains(target)) tvSeekTo(target)
        })
        // 兜底：播放位置掉在缓冲区外（时间轴不连续）时贴到实际有数据的直播边缘
        player.hls.on(window.Hls.Events.FRAG_BUFFERED, () => {
          const b = videoEl.buffered
          if (!b.length) return
          const t = videoEl.currentTime
          if (t >= b.start(0) - 0.2 && t <= b.end(b.length - 1)) return
          tvSeekTo(Math.max(b.start(0), b.end(b.length - 1) - 0.5))
        })
        // 定时巡检：seek 卡死或播放停滞持续数秒时重建连接；否则把播放头拉回已缓冲的直播边缘。
        if (player.liveWatchdog) clearInterval(player.liveWatchdog)
        player.liveWatchdog = setInterval(() => {
          if (player.current !== item || !player.hls) {
            clearInterval(player.liveWatchdog)
            player.liveWatchdog = null
            return
          }
          const now = Date.now()
          const b = videoEl.buffered
          if (b.length && videoEl.readyState >= 1) {
            const t0 = videoEl.currentTime
            const lastIdx = b.length - 1
            // 播放头落在缓冲区外（源时间轴整体偏移时 hls.js 会把 currentTime 设到未缓冲点），
            // 此时即使 seeking 挂起也要强制拉回已缓冲边缘，否则画面会永久冻住。
            if (t0 < b.start(0) - 0.3 || t0 > b.end(lastIdx) + 0.2) {
              tvSeekTo(Math.max(b.start(0), b.end(lastIdx) - 0.3), true)
            }
          }
          if (videoEl.seeking) {
            if (!player.seekStuckAt) player.seekStuckAt = now
            else if (now - player.seekStuckAt > 6000) {
              player.seekStuckAt = 0
              recoverLive()
            }
            return
          }
          player.seekStuckAt = 0
          if (!b.length || videoEl.readyState < 1) return
          const t = videoEl.currentTime
          if (player.lastProgressTime < 0 || Math.abs(t - player.lastProgressTime) > 0.3) {
            player.lastProgressTime = t
            player.stallAt = 0
          } else if (!videoEl.paused) {
            if (!player.stallAt) player.stallAt = now
            else if (now - player.stallAt > 12000) {
              player.stallAt = 0
              recoverLive()
              return
            }
          }
          const last = b.length - 1
          if (t >= b.start(0) - 0.3 && t <= b.end(last)) return
          tvSeekTo(Math.max(b.start(0), b.end(last) - 0.3))
        }, 1000)
      }
      player.hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data || !data.fatal) return
        if (item.tvUrls && player.tvIndex < item.tvUrls.length - 1) {
          player.tvIndex += 1
          item.src = item.tvUrls[player.tvIndex]
          if (player.hls) {
            player.hls.destroy()
            player.hls = null
          }
          setPlayerSrc(item)
          return
        }
        // 当前片源整体失效（证书过期、域名挂掉、分片 404 等）时尝试同名作品的备用片源
        if (item.altSrcs && item.altSrcs.length && !player.altSwitching) {
          tryAltSource(item).then((ok) => {
            if (!ok && player.current === item && player.open) showPlayerError()
          })
          return
        }
        showPlayerError()
      })
      player.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        // 安卓 WebView 中异步解析后的 play() 会丢失用户手势，这里在清单就绪后重新触发播放
        videoEl.play().catch(() => {})
      })
      player.hls.loadSource(src)
      player.hls.attachMedia(videoEl)
    } else {
      videoEl.src = src
    }
  } else {
    videoEl.src = src
  }
  videoEl.play().catch(() => {})
}

function attachSubtitle(item) {
  if (!item.subtitle) return
  fetch(encodePath(item.subtitle))
    .then((response) => response.text())
    .then((text) => {
      if (player.current !== item) return
      const content = /\.vtt$/i.test(item.subtitle) ? text : srtToVtt(text)
      player.objectUrl = URL.createObjectURL(new Blob([content], { type: 'text/vtt' }))
      const track = document.createElement('track')
      track.kind = 'subtitles'
      track.label = '字幕'
      track.srclang = 'zh'
      track.default = true
      track.src = player.objectUrl
      videoEl.appendChild(track)
      if (track.track) track.track.mode = 'showing'
      document.getElementById('playerSubtitle').classList.remove('is-off')
    })
    .catch(() => {})
}

function srtToVtt(text) {
  return (
    'WEBVTT\n\n' +
    String(text)
      .replace(/^\uFEFF/, '')
      .replace(/\r+/g, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
      .replace(/^\d+[ \t]*\n(?=\d{2}:\d{2}:\d{2})/gm, '')
  )
}

function resetPlayerMedia() {
  if (player.hls) {
    player.hls.destroy()
    player.hls = null
  }
  videoEl.pause()
  videoEl.removeAttribute('src')
  videoEl.querySelectorAll('track').forEach((track) => track.remove())
  videoEl.load()
  if (player.objectUrl) {
    URL.revokeObjectURL(player.objectUrl)
    player.objectUrl = null
  }
  playerErrorEl.classList.add('hidden')
  playerLoadingEl.classList.add('hidden')
  document.getElementById('playerSubtitle').classList.add('is-off')
}

const MEDIA_URL_RE = /\.(m3u8|mp4|webm|m4v|mov|ogv|ts|mpd)(?:[?#]|$)/i
const mediaUrlCache = new Map()

function looksLikeMedia(url) {
  return MEDIA_URL_RE.test(url || '')
}

// 部分源站给的是播放页地址（HTML），其中才写着真实的 m3u8 地址
async function resolveMediaUrl(raw) {
  const url = String(raw || '').trim()
  if (!url) return ''
  if (looksLikeMedia(url)) return url
  if (mediaUrlCache.has(url)) return mediaUrlCache.get(url)
  // WebView 的 fetch 会被 CORS 拦住，失败时用原生请求再取一次页面内容
  const grab = async (target) => {
    let text = ''
    try {
      const response = await fetch(target, { referrerPolicy: 'no-referrer' })
      text = await response.text()
    } catch {
      text = ''
    }
    if (!text && bridge && typeof bridge.tvFetchText === 'function') {
      try {
        text = await bridge.tvFetchText({ url: target })
      } catch {
        text = ''
      }
    }
    return text || ''
  }
  let found = ''
  const text = await grab(url)
  const hit = text.match(/(?:https?:\/\/|\/)[^"'\s<>]*?\.m3u8[^"'\s<>]*/i)
  if (hit && hit[0]) {
    try {
      found = new URL(hit[0], url).toString()
    } catch {
      found = ''
    }
  }
  if (!found) {
    const guess = url.replace(/\/+$/, '') + '/index.m3u8'
    const guessText = await grab(guess)
    if (guessText.includes('#EXTM3U')) found = guess
  }
  if (found) mediaUrlCache.set(url, found)
  return found
}

/* 备用线路：当前片源的清单/分片失效时，切到同名作品的其他片源 */
async function tryAltSource(item) {
  if (!item || !item.altSrcs || !item.altSrcs.length || player.altSwitching) return false
  player.altSwitching = true
  try {
    while ((item.altIndex || 0) < item.altSrcs.length) {
      const alt = item.altSrcs[item.altIndex]
      item.altIndex += 1
      const resolved = await resolveMediaUrl(alt.url)
      if (player.current !== item || !player.open) return false
      if (!resolved) continue
      item.src = resolved
      item.meta = alt.source || item.meta
      const subEl = playerEl.querySelector('.player-sub')
      if (subEl) subEl.textContent = [item.label, item.meta].filter(Boolean).join(' · ')
      toast(`已切换备用源：${alt.source || '其他片源'}`)
      if (player.hls) {
        try {
          player.hls.destroy()
        } catch (err) {}
        player.hls = null
      }
      setPlayerSrc(item)
      return true
    }
    return false
  } finally {
    player.altSwitching = false
  }
}

async function loadCurrent() {
  const item = player.queue[player.index]
  if (!item) {
    closePlayer()
    return
  }
  player.current = item
  player.tvIndex = 0
  player.liveRecoveries = 0
  item.altIndex = 0
  if (item.tvUrls && item.tvUrls.length) item.src = item.tvUrls[0]
  resetPlayerMedia()
  playerEl.classList.remove('idle')
  player.resumePending = true
  recordPlay(item)

  playerEl.querySelector('.player-title').textContent = item.title
  playerEl.querySelector('.player-sub').textContent = [item.label, item.meta].filter(Boolean).join(' · ')

  const subtitleBtn = document.getElementById('playerSubtitle')
  subtitleBtn.disabled = !item.subtitle
  document.getElementById('playerExternal').disabled = !item.file
  playerNextEl.classList.toggle('hidden', player.index >= player.queue.length - 1)

  if (item.yh) {
    playerLoadingEl.classList.remove('hidden')
    const resolved = await yhEpisodeUrl(item.vodId, item.nid)
    if (player.current !== item || !player.open) return
    if (!resolved) {
      showPlayerError()
      return
    }
    item.src = resolved
    recordPlay(item)
  } else if (!item.file && /^https?:/i.test(item.src || '')) {
    playerLoadingEl.classList.remove('hidden')
    let resolved = ''
    if (item.tvUrls && item.tvUrls.length) {
      for (player.tvIndex = 0; player.tvIndex < item.tvUrls.length; player.tvIndex += 1) {
        resolved = await resolveMediaUrl(item.tvUrls[player.tvIndex])
        if (player.current !== item || !player.open) return
        if (resolved) break
      }
    } else {
      resolved = await resolveMediaUrl(item.src)
      if (player.current !== item || !player.open) return
    }
    if (!resolved) {
      const switched = await tryAltSource(item)
      if (player.current !== item || !player.open) return
      if (switched) return
      showPlayerError()
      return
    }
    item.src = resolved
  }

  setPlayerSrc(item)
  attachSubtitle(item)

  clearTimeout(player.hideTimer)
  player.hideTimer = setTimeout(() => {
    if (!videoEl.paused) playerEl.classList.add('idle')
  }, 2600)
}

function openPlayer(queue, index) {
  if (!queue.length) return
  player.queue = queue
  player.index = index
  player.open = true
  detailEl.classList.add('hidden')
  playerEl.classList.remove('hidden')
  loadCurrent()
}

function persistProgress() {
  const item = player.current
  if (!item) return
  if (item.tvUrls) return
  const duration = videoEl.duration
  if (!Number.isFinite(duration) || duration <= 0) return
  const ended = videoEl.ended
  const seconds = ended ? duration : videoEl.currentTime
  if (!ended && seconds < 3) return
  state.progress[item.id] = { seconds, duration, at: Date.now() }
  saveProgress()
}

function playNext() {
  if (!player.open) return
  if (player.index >= player.queue.length - 1) {
    toast('已经是最后一个了')
    return
  }
  persistProgress()
  player.index += 1
  loadCurrent()
  toast('正在播放下一集')
}

function closePlayer() {
  if (!player.open) return
  persistProgress()
  resetPlayerMedia()
  player.open = false
  player.current = null
  player.queue = []
  playerEl.classList.add('hidden')
  playerEl.classList.remove('idle')
  clearTimeout(player.hideTimer)
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  render()
}

function showPlayerError() {
  const item = player.current || {}
  const isNetwork = item.yh || (!item.file && /^https?:/i.test(item.src || ''))
  playerLoadingEl.classList.add('hidden')
  if (item.audio) {
    playerErrorEl.innerHTML = `
      <div class="error-mark">!</div>
      <h2>音频加载失败</h2>
      <p>该歌曲的音源可能已失效或被音乐平台限制播放。可点「重试」重新解析，或在软件内登录对应音乐平台账号后再试。</p>
      <div class="error-actions">
        <button class="btn primary" data-action="player-retry">重试</button>
        <button class="btn ghost" data-action="player-close">返回歌单</button>
      </div>`
  } else if (isNetwork) {
    const hasNext = player.index < player.queue.length - 1
    playerErrorEl.innerHTML = `
      <div class="error-mark">!</div>
      <h2>网络片源加载失败</h2>
      <p>该片源可能已失效、被源站限制播放，或当前网络不稳定。可点「重试」重新加载，${hasNext ? '或换下一集试试。' : '或更换设置里的搜索源。'}</p>
      <div class="error-actions">
        <button class="btn primary" data-action="player-retry">重试</button>
        ${hasNext ? '<button class="btn ghost" data-action="player-next">换下一集</button>' : ''}
        <button class="btn ghost" data-action="player-close">返回片库</button>
      </div>`
  } else {
    playerErrorEl.innerHTML = `
      <div class="error-mark">!</div>
      <h2>这个视频无法用内置播放器播放</h2>
      <p>通常是 MKV、HEVC 等编码格式不被内置播放器支持，可以用系统播放器打开。</p>
      <div class="error-actions">
        <button class="btn primary" data-action="player-external">用系统播放器打开</button>
        <button class="btn ghost" data-action="player-close">返回片库</button>
      </div>`
  }
  playerErrorEl.classList.remove('hidden')
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
    return
  }
  const request = playerEl.requestFullscreen ? playerEl.requestFullscreen() : Promise.reject()
  request.catch(() => {
    // iOS 的 Safari/WKWebView 不支持普通元素全屏，退化成视频原生全屏
    if (typeof videoEl.webkitEnterFullscreen === 'function') videoEl.webkitEnterFullscreen()
  })
}

/* ---------- 全网搜索 ---------- */

function parsePlayUrl(raw) {
  const firstSource = String(raw || '').split('$$$')[0]
  return firstSource
    .split('#')
    .map((part) => {
      const idx = part.indexOf('$')
      if (idx <= 0) return null
      const name = part.slice(0, idx).trim()
      const url = part.slice(idx + 1).trim()
      if (!/^https?:\/\//i.test(url)) return null
      return { name, url }
    })
    .filter(Boolean)
}

let webSearchTimer = null

function scheduleWebSearch(query) {
  clearTimeout(webSearchTimer)
  if (!query) {
    state.webSearch = { query: '', searching: false, results: [] }
    return
  }
  webSearchTimer = setTimeout(() => runWebSearch(query), 600)
}

function mapVodEntry(source, vod) {
  const title = String(vod.vod_name || '').trim()
  if (!title) return null
  const episodes = parsePlayUrl(String(vod.vod_play_url || ''))
  if (!episodes.length) return null
  return {
    key: `w:${source.api}::${vod.vod_id}`,
    title,
    pic: /^https?:\/\//i.test(String(vod.vod_pic || '')) ? String(vod.vod_pic) : '',
    year: String(vod.vod_year || ''),
    type: String(vod.type_name || ''),
    remarks: String(vod.vod_remarks || ''),
    hot: Number(vod.vod_hits) || 0,
    updated: String(vod.vod_time || vod.vod_pubdate || ''),
    source: source.name,
    episodes
  }
}

/* query: { wd: 关键词 } 或 { t: 分类 id } */
function raceTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
}

async function fetchSourcePage(source, query, page) {
  if (source.type === 'yh' || source.api === YH_API_HOST) {
    return { entries: await raceTimeout(yhSearch(String(query.wd || '')), 6000) }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const params = []
    if (query.t) params.push(`t=${query.t}`)
    if (query.area) params.push(`area=${encodeURIComponent(query.area)}`)
    if (!params.length) params.push(`wd=${encodeURIComponent(query.wd || '')}`)
    const term = params.join('&')
    const res = await fetch(`${source.api}?ac=videolist&${term}&pg=${Number(page) || 1}`, {
      signal: controller.signal
    })
    const data = await res.json()
    const list = Array.isArray(data && data.list) ? data.list : []
    return {
      entries: list.map((vod) => mapVodEntry(source, vod)).filter(Boolean),
      pagecount: Number(data && data.pagecount) || 0
    }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWebEntries(query, limit = 80, page = 1) {
  const sources = (state.settings.sources || []).filter((source) => source.enabled)
  if (!sources.length) return []
  const responses = await Promise.allSettled(
    sources.map((source) => fetchSourcePage(source, { wd: query }, page))
  )

  const seen = new Set()
  const results = []
  for (const response of responses) {
    if (response.status !== 'fulfilled') continue
    for (const entry of response.value.entries) {
      const dedupe = `${entry.title}|${entry.year || ''}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      state.webMap.set(entry.key, entry)
      results.push(entry)
      if (results.length >= limit) return results
    }
  }
  return results
}

async function runWebSearch(query) {
  recordSearch(query)
  const sources = (state.settings.sources || []).filter((source) => source.enabled)
  if (!sources.length) {
    state.webSearch = { query, searching: false, results: [] }
    if (state.query === query) render()
    return
  }
  state.webSearch = { query, searching: true, results: [] }
  if (state.query === query) render()

  const results = await fetchWebEntries(query, 80)

  state.webSearch = { query, searching: false, results }
  if (state.query === query) render()
}

/* ---------- 交互 ---------- */

async function persistSettings() {
  state.settings = await bridge.saveSettings(state.settings)
}

async function addFolder() {
  const paths = await bridge.pickFolders()
  if (!paths || !paths.length) return
  const merged = [...new Set([...(state.settings.folders || []), ...paths])]
  state.settings.folders = merged
  await persistSettings()
  await scan()
  toast('已添加影片文件夹')
}

async function removeFolder(folder) {
  state.settings.folders = (state.settings.folders || []).filter((item) => item !== folder)
  await persistSettings()
  await scan()
  toast('已移除文件夹')
}

async function scan() {
  if (!state.settings.folders.length) {
    state.library = { movies: [], series: [], errors: [], totalFiles: 0 }
    state.scanning = false
    render()
    return
  }
  state.scanning = true
  render()
  try {
    state.library = await bridge.scan(state.settings.folders)
  } catch (error) {
    toast(`扫描失败：${error?.message || error}`)
  } finally {
    state.scanning = false
  }
  render()
}

async function addOnlineLink(form) {
  const title = String(form.title.value || '').trim()
  const url = String(form.url.value || '').trim()
  const poster = String(form.poster.value || '').trim()
  if (!/^https?:\/\//i.test(url)) {
    toast('请输入 http:// 或 https:// 开头的播放地址')
    return
  }
  const id = `o:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  state.settings.online = [
    ...(state.settings.online || []),
    { id, title: title || '未命名在线影片', url, poster: /^https?:\/\//i.test(poster) ? poster : '', addedAt: Date.now() }
  ]
  await persistSettings()
  form.reset()
  render()
  toast('已添加到在线片单')
}

async function addSource(form) {
  const name = String(form.name.value || '').trim()
  const api = String(form.api.value || '').trim()
  if (!/^https?:\/\//i.test(api)) {
    toast('请输入 http:// 或 https:// 开头的接口地址')
    return
  }
  state.settings.sources = [...(state.settings.sources || []), { name: name || '自定义源', api, enabled: true }]
  await persistSettings()
  form.reset()
  render()
  toast('已添加搜索源')
}

async function deleteOnline(id) {
  if (isBuiltIn(id)) {
    toast('内置影片无需移除')
    return
  }
  state.settings.online = (state.settings.online || []).filter((item) => item.id !== id)
  delete state.progress[id]
  saveProgress()
  await persistSettings()
  closeDetail()
  render()
  toast('已从片单移除')
}

async function handleAction(action, element) {
  switch (action) {
    case 'add-folder':
      addFolder()
      break
    case 'rescan':
      scan()
      break
    case 'remove-folder':
      removeFolder(element.dataset.folder)
      break
    case 'goto-online':
      state.view = 'online'
      contentEl.scrollTop = 0
      render()
      ensureMovieLoaded()
      break
    case 'hero-play': {
      const kind = element.dataset.kind
      const id = element.dataset.id
      if (kind === 'series') {
        const series = state.library.series.find((entry) => entry.id === id)
        const first = series?.episodes.find((episode) => episode.playable) || series?.episodes[0]
        if (series && first) playEpisode(series, first.id)
      } else if (kind === 'online') {
        playOnline(allOnlineItems().find((entry) => entry.id === id))
      } else {
        playById(id)
      }
      break
    }
    case 'hero-detail':
      openDetail(element.dataset.kind, element.dataset.id)
      break
    case 'detail-play': {
      const id = element.dataset.id
      closeDetail()
      playById(id)
      break
    }
    case 'detail-play-online': {
      const online = allOnlineItems().find((entry) => entry.id === element.dataset.id)
      closeDetail()
      playOnline(online)
      break
    }
    case 'detail-play-series': {
      const series = state.library.series.find((entry) => entry.id === element.dataset.series)
      const first = series?.episodes.find((episode) => episode.playable) || series?.episodes[0]
      closeDetail()
      if (series && first) playEpisode(series, first.id)
      break
    }
    case 'detail-play-episode': {
      const series = state.library.series.find((entry) => entry.id === element.dataset.series)
      const episodeId = element.dataset.episode
      closeDetail()
      playEpisode(series, episodeId)
      break
    }
    case 'external':
      bridge.openPath(element.dataset.file)
      break
    case 'delete-online':
      deleteOnline(element.dataset.id)
      break
    case 'web-play':
    case 'web-play-ep': {
      const item = state.webMap.get(element.dataset.key)
      closeDetail()
      if (item) playWeb(item, Number(element.dataset.idx || 0))
      break
    }
    case 'delete-source': {
      const idx = Number(element.dataset.idx)
      state.settings.sources = (state.settings.sources || []).filter((_entry, i) => i !== idx)
      await persistSettings()
      render()
      toast('已移除搜索源')
      break
    }
    case 'reset-sources':
      state.settings.sources = DEFAULT_SOURCES.map((source) => ({ ...source }))
      persistSettings()
      render()
      toast('已恢复默认搜索源')
      break
    case 'toggle-sources':
      state.sourcesCollapsed = !state.sourcesCollapsed
      render()
      break
    case 'open-book':
      openBookReader(element.dataset.bookId)
      break
    case 'novel-category': {
      const catId = element.dataset.cat
      if (state.books.category === catId) break
      state.books.category = catId
      state.books.search = ''
      state.books.loaded = false
      state.books.results = []
      contentEl.scrollTop = 0
      render()
      loadNovel()
      break
    }
    case 'drama-sort': {
      const slot = categorySlot('drama')
      const sort = element.dataset.sort
      if (slot.sort === sort) break
      slot.sort = sort
      sortCategoryResults(slot)
      render()
      break
    }
    case 'category-reload': {
      // AI 短剧空态：手动重试拉取片源
      const view = CATEGORY_VIEWS[state.view] ? state.view : ''
      if (!view) break
      const slot = categorySlot(view)
      slot.loaded = false
      slot.lastDate = ''
      slot.results = []
      render()
      loadCategory(view)
      break
    }
    case 'book-close':
      closeBookReader()
      break
    case 'book-prev':
      if (state.bookReader) readBookChapter(state.bookReader.currentIndex - 1)
      break
    case 'book-next':
      if (state.bookReader) readBookChapter(state.bookReader.currentIndex + 1)
      break
    case 'play-history': {
      const entry = state.history.find((record) => record.id === element.dataset.id)
      if (entry) playHistoryEntry(entry)
      break
    }
    case 'clear-history':
      state.history = []
      saveHistory()
      render()
      toast('已清空播放记录')
      break
    case 'use-search': {
      const value = element.dataset.query || ''
      state.query = value
      searchInput.value = value
      contentEl.scrollTop = 0
      render()
      scheduleWebSearch(value)
      break
    }
    case 'delete-search': {
      const value = element.dataset.query || ''
      state.searches = state.searches.filter((record) => record.q !== value)
      saveSearches()
      render()
      break
    }
    case 'clear-searches':
      state.searches = []
      saveSearches()
      render()
      toast('已清空搜索记录')
      break
    case 'close-detail':
      closeDetail()
      break
    case 'tv-play':
      playTv(Number(element.dataset.index) || 0)
      break
    case 'tv-toggle': {
      const slot = tvSlot()
      if (!slot.collapsed) slot.collapsed = {}
      const group = element.dataset.group || ''
      slot.collapsed[group] = !slot.collapsed[group]
      if (state.view === 'tv') render()
      break
    }
    case 'tv-layout': {
      const slot = tvSlot()
      slot.layout = slot.layout === 'list' ? 'grid' : 'list'
      if (state.view === 'tv') render()
      break
    }
    case 'cctv-site': {
      if (bridge && typeof bridge.openCctv === 'function') bridge.openCctv()
      break
    }
    case 'music-tag': {
      const slot = categorySlot('music')
      slot.musicTag = element.dataset.tag || '全部'
      if (state.view === 'music') render()
      break
    }
    case 'tt-search-do': {
      // 直接用按钮点击触发搜索，避免 WebView 中表单提交被输入法吞掉
      const input = document.getElementById('ttKeyword')
      if (input) input.blur()
      ttSearch(input ? input.value : '')
      break
    }
    case 'tt-play':
      ttToggle()
      break
    case 'tt-mute':
      ttApplyVolume(ttAudio.volume > 0 ? 0 : ttLastVolume || 0.8)
      break
    case 'tt-prev':
      ttStep(-1)
      break
    case 'tt-next':
      ttStep(1)
      break
    case 'tt-set-mode': {
      const tt = ttSlot()
      tt.mode = element.dataset.mode || 'order'
      if (state.view === 'music') render()
      break
    }
    case 'tt-lyric-mode': {
      const tt = ttSlot()
      tt.lyricMode = element.dataset.mode || 'scroll'
      if (state.view === 'music') render()
      break
    }
    case 'tt-motion-next':
      ttMotionNextStyle()
      break
    case 'tt-pick':
      ttPlay(Number(element.dataset.index) || 0)
      break
    case 'tt-reload': {
      const tt = ttSlot()
      tt.error = ''
      if (tt.query) ttSearch(tt.query)
      else {
        tt.loaded = false
        ttLoadChart()
      }
      break
    }
    case 'tt-chart':
      ttLoadChart()
      break
    case 'tt-tools-toggle': {
      // 播放列表上方的页签/音源/搜索自动隐藏，给歌单腾出更多高度
      const tts = ttSlot()
      tts.toolsOpen = !tts.toolsOpen
      window.clearTimeout(tts.toolsTimer)
      render()
      if (tts.toolsOpen) {
        tts.toolsTimer = window.setTimeout(() => {
          tts.toolsOpen = false
          if (state.view === 'music') render()
        }, 6000)
      }
      break
    }
    case 'tt-vendor':
      ttLoadVendor(element.dataset.vendor)
      break
    case 'tt-panel': {
      const tt = ttSlot()
      tt.panel = element.dataset.panel || 'list'
      tt.searchMode = false
      tt.openPlaylist = ''
      tt.picker = null
      tt.renaming = ''
      if (tt.panel === 'top') ttLoadToplists()
      if (state.view === 'music') render()
      break
    }
    case 'tt-top-list': {
      const id = element.dataset.id
      const name = element.dataset.name || '热门歌单'
      if (id) ttLoadToplist(id, name)
      break
    }
    case 'tt-reload-top': {
      const tt = ttSlot()
      tt.toplists = []
      tt.toplistsLoading = false
      ttLoadToplists()
      break
    }
    case 'tt-like': {
      const song = ttFindSongByKey(element.dataset.key)
      ttToggleFavorite(song)
      break
    }
    case 'tt-add': {
      const tt = ttSlot()
      tt.picker = { key: element.dataset.key || '' }
      if (state.view === 'music') render()
      break
    }
    case 'tt-picker-close': {
      ttSlot().picker = null
      if (state.view === 'music') render()
      break
    }
    case 'tt-add-to': {
      const song = ttSlot().picker ? ttFindSongByKey(ttSlot().picker.key) : null
      ttAddToPlaylist(element.dataset.pid, song)
      break
    }
    case 'tt-new-pl': {
      const tt = ttSlot()
      const lib = musicLibData()
      const playlist = ttCreatePlaylist(`我的歌单 ${lib.playlists.length + 1}`, null)
      tt.panel = 'pl'
      tt.openPlaylist = ''
      tt.renaming = playlist.id
      if (state.view === 'music') render()
      break
    }
    case 'tt-open-pl': {
      const tt = ttSlot()
      tt.panel = 'pl'
      tt.openPlaylist = element.dataset.pid || ''
      tt.searchMode = false
      tt.renaming = ''
      if (state.view === 'music') render()
      break
    }
    case 'tt-back-pl': {
      const tt = ttSlot()
      tt.openPlaylist = ''
      tt.renaming = ''
      if (state.view === 'music') render()
      break
    }
    case 'tt-rename-start': {
      ttSlot().renaming = element.dataset.pid || ''
      if (state.view === 'music') render()
      break
    }
    case 'tt-del-pl': {
      const lib = musicLibData()
      const pid = element.dataset.pid
      const playlist = lib.playlists.find((item) => item.id === pid)
      if (!playlist) break
      lib.playlists = lib.playlists.filter((item) => item.id !== pid)
      musicLibSave()
      const tt = ttSlot()
      if (tt.openPlaylist === pid) tt.openPlaylist = ''
      if (tt.renaming === pid) tt.renaming = ''
      toast(`已删除歌单「${playlist.name}」`)
      if (state.view === 'music') render()
      break
    }
    case 'music-source': {
      const slot = categorySlot('music')
      slot.musicSource = element.dataset.source || 'web'
      if (slot.musicSource !== 'tt' && !ttAudio.paused) ttAudio.pause()
      if (slot.musicSource === 'cc' && !ccSlot().loaded) loadCcMusic()
      if (slot.musicSource === 'tt') ensureTtLoaded()
      if (state.view === 'music') render()
      break
    }
    case 'kg-star':
      loadKugou(element.dataset.keyword || '')
      break
    case 'kg-sort': {
      kgSlot().sort = element.dataset.sort || 'hot'
      if (state.view === 'music') render()
      break
    }
    case 'kg-open': {
      playKugou(
        element.dataset.hash || '',
        element.dataset.album || '',
        element.dataset.title || '',
        element.dataset.artist || ''
      )
      break
    }
    case 'music-login': {
      if (element.dataset.platform === 'qishui') {
        openQishuiLogin()
        break
      }
      if (bridge && typeof bridge.musicLogin === 'function') {
        bridge.musicLogin({ platform: element.dataset.platform || 'qq' })
        toast('请在打开的窗口内登录，登录后即可直接播放')
      }
      break
    }
    case 'qs-qr-refresh': {
      openQishuiLogin(true)
      break
    }
    case 'qs-qr-close': {
      closeQishuiLogin()
      break
    }
    case 'qq-star':
      loadQq(element.dataset.keyword || '')
      break
    case 'qq-open': {
      playQq(
        element.dataset.mid || '',
        element.dataset.title || '',
        element.dataset.artist || ''
      )
      break
    }
    case 'qs-star':
      loadQishui(element.dataset.keyword || '')
      break
    case 'qs-sort': {
      qsSlot().sort = element.dataset.sort || 'recommend'
      if (state.view === 'music') render()
      break
    }
    case 'qs-open': {
      playQishui(
        element.dataset.qid || '',
        element.dataset.title || '',
        element.dataset.artist || ''
      )
      break
    }
    case 'qs-free': {
      const qs = qsSlot()
      qs.freeOnly = !qs.freeOnly
      if (state.view === 'music') render()
      break
    }
    case 'qs-vip': {
      if (bridge && typeof bridge.openQishui === 'function') {
        bridge.openQishui({ vip: true })
      }
      toast('已打开汽水音乐会员页，可在官方页面开通')
      break
    }
    case 'qq-search-page': {
      if (bridge && typeof bridge.openQq === 'function') {
        bridge.openQq({ keyword: qqSlot().keyword })
      }
      break
    }
    case 'platform-open': {
      const key = element.dataset.platform || 'douyin'
      const keyword = element.dataset.keyword || ''
      officialSlot(key).keyword = keyword
      openPlatform(key, keyword)
      if (state.view === 'music') render()
      break
    }
    case 'cc-tag': {
      const slot = categorySlot('music')
      slot.ccTag = element.dataset.tag || '全部'
      if (state.view === 'music') render()
      break
    }
    case 'movie-genre': {
      state.movieGenre = element.dataset.genre || 'hot'
      const slot = movieSlot(state.movieGenre)
      if (!slot.loaded && !slot.loading) loadMoviePage(1, state.movieGenre)
      else if (state.view === 'online') render()
      break
    }
    case 'movie-more': {
      const slot = movieSlot(state.movieGenre)
      loadMoviePage((slot.page || 0) + 1, state.movieGenre)
      break
    }
    case 'movie-reload': {
      const slot = movieSlot(state.movieGenre)
      slot.results = []
      slot.page = 0
      slot.hasMore = true
      slot.loaded = false
      slot.error = ''
      loadMoviePage(1, state.movieGenre)
      break
    }
    case 'anime-sort': {
      const slot = categorySlot('anime')
      slot.sort = element.dataset.sort || 'hot'
      if (state.view === 'anime') render()
      break
    }
    case 'anime-more': {
      const slot = categorySlot('anime')
      loadAnimePage((slot.page || 0) + 1)
      break
    }
    case 'anime-reload': {
      const slot = categorySlot('anime')
      slot.results = []
      slot.page = 0
      slot.hasMore = true
      slot.loaded = false
      slot.error = ''
      loadAnimePage(1)
      break
    }
    case 'cc-sort': {
      const slot = categorySlot('music')
      slot.ccSort = element.dataset.sort || 'hot'
      if (state.view === 'music') render()
      break
    }
    case 'cc-more':
      loadCcMusic()
      break
    case 'music-open':
      openDetail('web', element.dataset.id || '')
      break
    case 'tv-reload': {
      const slot = tvSlot()
      slot.loaded = false
      slot.error = ''
      loadTv()
      break
    }
    default:
      break
  }
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view))
  })
  document.querySelectorAll('.topbar-action').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view))
  })
}

function switchView(nextView) {
  if (nextView !== 'music' && !ttAudio.paused) ttAudio.pause()
  if (nextView === 'music') categorySlot('music').musicSource = 'tt'
  if (nextView === 'drama') {
    const dramaSlot = categorySlot('drama')
    dramaSlot.search = ''
    dramaSlot.loaded = false
  }
  state.view = nextView
  state.query = ''
  searchInput.value = ''
  contentEl.scrollTop = 0
  render()
  if (state.view === 'tv') {
    loadTv()
    maybeValidateTv()
  }
  if (state.view === 'online' || state.view === 'home') ensureMovieLoaded()
  if (state.view === 'novel') loadNovel()
  else if (CATEGORY_VIEWS[state.view]) loadCategory(state.view)
}

  document.getElementById('winMin').addEventListener('click', () => bridge.minimize())
  document.getElementById('winMax').addEventListener('click', () => bridge.toggleMaximize())
  document.getElementById('winClose').addEventListener('click', () => {
    // 播放视频时只关闭播放窗口回到片库，菜单页面才退出软件
    if (!playerEl.classList.contains('hidden')) {
      closePlayer()
      return
    }
    bridge.close()
  })

  let searchTimer = null
  function handleTopSearch(rawQuery, fromEnter) {
    const q = rawQuery.trim()
    if (state.view === 'drama') {
      // 短剧视图下：只在短剧片源内搜索，不跳转全网搜索
      state.query = ''
      const slot = categorySlot('drama')
      if (slot.search === q) return
      slot.search = q
      slot.loaded = false
      slot.results = []
      contentEl.scrollTop = 0
      render()
      loadCategory('drama', q)
      return
    }
    if (state.view === 'novel') {
      // 小说家视图下：搜索书籍
      state.query = ''
      const slot = state.books
      if (slot.search === q) return
      slot.search = q
      slot.loaded = false
      slot.results = []
      contentEl.scrollTop = 0
      render()
      loadNovel(q)
      return
    }
    state.query = q
    contentEl.scrollTop = 0
    render()
    scheduleWebSearch(q)
    if (fromEnter) recordSearch(q)
  }
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      handleTopSearch(searchInput.value.trim(), false)
    }, 120)
  })

  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    clearTimeout(searchTimer)
    handleTopSearch(searchInput.value.trim(), true)
  })

  const musicTabsEl = document.getElementById('musicTabs')
  if (musicTabsEl) {
    musicTabsEl.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]')
      if (!actionEl) return
      handleAction(actionEl.dataset.action, actionEl)
    })
  }

  contentEl.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]')
    if (actionEl) {
      handleAction(actionEl.dataset.action, actionEl)
      return
    }
    const card = event.target.closest('.card')
    if (!card) return
    const id = card.dataset.id
    if (card.dataset.play === '1') playById(id)
    else if (card.dataset.kind === 'series') openDetail('series', id)
    else if (card.dataset.kind === 'online') openDetail('online', id)
    else if (card.dataset.kind === 'web') openDetail('web', id)
    else if (card.dataset.kind === 'movie') openDetail('movie', id)
  })

  // 进度条点击 / 拖动跳转
  function seekProgress(clientX) {
    const bar = document.getElementById('ttProgress')
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const duration = Number(ttAudio.duration) || 0
    if (duration > 0) {
      ttAudio.currentTime = duration * ratio
      ttSyncUi()
    }
  }
  let draggingProgress = false
  contentEl.addEventListener('mousedown', (event) => {
    const bar = event.target.closest('#ttProgress')
    if (!bar) return
    event.preventDefault()
    draggingProgress = true
    seekProgress(event.clientX)
  })
  document.addEventListener('mousemove', (event) => {
    if (!draggingProgress) return
    seekProgress(event.clientX)
  })
  document.addEventListener('mouseup', () => {
    draggingProgress = false
  })

  // 音乐音量滑块 / 搜索框输入时保持面板展开
  contentEl.addEventListener('input', (event) => {
    if (!event.target) return
    if (event.target.id === 'ttVolumeRange') ttApplyVolume(event.target.value)
    if (event.target.id === 'ttKeyword') ttToolsTouch()
  })

  // 搜索框回车直接触发搜索（安卓输入法“搜索”键）
  contentEl.addEventListener('keydown', (event) => {
    // 在搜索框里打字期间不要让面板自动收起
    if (event.target && event.target.id === 'ttKeyword') ttToolsTouch()
    if (event.key !== 'Enter') return
    const input = event.target
    if (!input || input.id !== 'ttKeyword') return
    event.preventDefault()
    input.blur()
    ttSearch(input.value)
  })

  // 软键盘组词、聚焦搜索框时也保持展开
  const ttTypingEvents = ['focusin', 'compositionstart', 'beforeinput']
  ttTypingEvents.forEach((type) => {
    contentEl.addEventListener(type, (event) => {
      if (event.target && event.target.id === 'ttKeyword') ttToolsTouch()
    })
  })

  contentEl.addEventListener('submit', (event) => {
    if (event.target.id === 'onlineForm') {
      event.preventDefault()
      addOnlineLink(event.target)
      return
    }
    if (event.target.id === 'sourceForm') {
      event.preventDefault()
      addSource(event.target)
      return
    }
    if (event.target.id === 'kgForm') {
      event.preventDefault()
      const input = event.target.querySelector('input')
      loadKugou(input ? input.value : '')
      return
    }
    if (event.target.id === 'qqForm') {
      event.preventDefault()
      const input = event.target.querySelector('input')
      loadQq(input ? input.value : '')
      return
    }
    if (event.target.id === 'qsForm') {
      event.preventDefault()
      const input = event.target.querySelector('input')
      loadQishui(input ? input.value : '')
      return
    }
    if (event.target.id === 'ttForm') {
      event.preventDefault()
      const input = event.target.querySelector('input')
      if (input) input.blur()
      ttSearch(input ? input.value : '')
      return
    }
    if (event.target.id === 'ttRenForm') {
      event.preventDefault()
      const input = event.target.querySelector('input')
      const pid = event.target.dataset.pid || ''
      const lib = musicLibData()
      const playlist = lib.playlists.find((item) => item.id === pid)
      const name = input ? input.value.trim() : ''
      if (playlist && name) {
        playlist.name = name
        musicLibSave()
        toast('歌单已重命名')
      }
      ttSlot().renaming = ''
      if (state.view === 'music') render()
      return
    }
    if (event.target.id === 'ttNewPlForm') {
      event.preventDefault()
      const input = event.target.querySelector('input')
      const name = input ? input.value.trim() : ''
      const song = ttSlot().picker ? ttFindSongByKey(ttSlot().picker.key) : null
      ttCreatePlaylist(name, song)
      return
    }
    if (event.target.id === 'offForm') {
      event.preventDefault()
      const platform = event.target.dataset.platform || 'douyin'
      const input = event.target.querySelector('input')
      const keyword = input ? input.value.trim() : ''
      officialSlot(platform).keyword = keyword
      openPlatform(platform, keyword)
      if (state.view === 'music') render()
    }
  })

  contentEl.addEventListener('change', (event) => {
    const sourceToggle = event.target.closest('input[data-source-toggle]')
    if (sourceToggle) {
      const idx = Number(sourceToggle.dataset.sourceToggle)
      if (state.settings.sources[idx]) {
        state.settings.sources[idx].enabled = sourceToggle.checked
        persistSettings()
      }
      return
    }
    const input = event.target.closest('input[data-pref]')
    if (!input) return
    state.settings.prefs[input.dataset.pref] = input.checked
    persistSettings()
  })

  contentEl.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'tvFilter') applyTvFilter()
  })

  contentEl.addEventListener('error', (event) => {
    const img = event.target
    if (!(img instanceof HTMLImageElement)) return
    const card = img.closest('.card[data-thumb]')
    if (!card) return
    if (img.src && img.src.startsWith('data:')) return
    if (img.src) brokenPics.add(img.src)
    render()
  }, true)

  detailEl.addEventListener('click', (event) => {
    if (event.target === detailEl) {
      closeDetail()
      return
    }
    const actionEl = event.target.closest('[data-action]')
    if (actionEl) handleAction(actionEl.dataset.action, actionEl)
  })

  playerEl.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]')
    if (!actionEl) return
    if (actionEl.dataset.action === 'player-external') {
      if (player.current?.file) bridge.openPath(player.current.file)
    } else if (actionEl.dataset.action === 'player-retry') {
      playerErrorEl.classList.add('hidden')
      loadCurrent()
      toast('正在重新加载')
    } else if (actionEl.dataset.action === 'player-next') {
      playNext()
    } else if (actionEl.dataset.action === 'player-close') {
      closePlayer()
    }
  })

  bookReaderEl.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]')
    if (!actionEl) return
    handleAction(actionEl.dataset.action, actionEl)
  })

  const hideLoading = () => playerLoadingEl.classList.add('hidden')
  videoEl.addEventListener('playing', hideLoading)
  videoEl.addEventListener('canplay', hideLoading)

  document.getElementById('playerBack').addEventListener('click', closePlayer)
  playerNextEl.addEventListener('click', playNext)
  document.getElementById('playerFullscreen').addEventListener('click', toggleFullscreen)
  document.getElementById('playerExternal').addEventListener('click', () => {
    if (player.current?.file) bridge.openPath(player.current.file)
  })
  document.getElementById('playerSubtitle').addEventListener('click', (event) => {
    const track = videoEl.querySelector('track')
    if (!track || !track.track) return
    const showing = track.track.mode === 'showing'
    track.track.mode = showing ? 'hidden' : 'showing'
    event.currentTarget.classList.toggle('is-off', showing)
  })

  playerEl.addEventListener('mousemove', () => {
    playerEl.classList.remove('idle')
    clearTimeout(player.hideTimer)
    player.hideTimer = setTimeout(() => {
      if (!videoEl.paused) playerEl.classList.add('idle')
    }, 2600)
  })

  videoEl.addEventListener('dblclick', toggleFullscreen)

  videoEl.addEventListener('loadedmetadata', () => {
    if (!player.current || !player.resumePending) return
    player.resumePending = false
    if (player.current.tvUrls) return
    const entry = state.progress[player.current.id]
    if (!state.settings.prefs.resume || !entry) return
    if (entry.seconds > 8 && entry.duration - entry.seconds > 15) {
      videoEl.currentTime = Math.min(entry.seconds, Math.max(0, videoEl.duration - 4))
      toast(`已从 ${formatTime(entry.seconds)} 继续播放`)
    }
  })

  videoEl.addEventListener('timeupdate', () => {
    if (!player.open || videoEl.ended) return
    if (player.current && player.current.tvUrls && player.hls && Number.isFinite(player.hls.liveSyncPosition)) {
      const target = player.hls.liveSyncPosition
      const drift = target - videoEl.currentTime
      if (drift > 2.5) {
        // 目标点必须在已缓冲范围内，否则 seek 会永久卡住
        if (tvBufferedContains(target)) tvSeekTo(target)
        else videoEl.playbackRate = 1
      } else if (drift > 0.6) {
        videoEl.playbackRate = 1.5
      } else if (drift < 0.25) {
        videoEl.playbackRate = 1
      }
    }
    const now = Date.now()
    if (now - player.saveAt < 5000) return
    player.saveAt = now
    persistProgress()
  })

  videoEl.addEventListener('pause', () => {
    if (!player.open) return
    persistProgress()
  })

  videoEl.addEventListener('ended', () => {
    persistProgress()
    if (state.settings.prefs.autoplayNext && player.index < player.queue.length - 1) {
      player.index += 1
      loadCurrent()
      toast('正在播放下一集')
    }
  })

  videoEl.addEventListener('error', () => {
    if (!player.open) return
    // iOS 原生播放时没有 hls.js 的错误回调，这里接管电视台的线路切换
    if (IS_IOS && player.current && player.current.tvUrls) {
      // code 1 = 主动中断（切换 src 时会出现），忽略
      if (videoEl.error && videoEl.error.code === 1) return
      switchTvLine(player.current)
      return
    }
    showPlayerError()
  })

  document.addEventListener(
    'load',
    (event) => {
      const el = event.target
      if (!el || el.tagName !== 'IMG') return
      gyLoadedCovers.add(el.currentSrc || el.src)
      el.classList.add('is-loaded')
    },
    true
  )

  document.addEventListener(
    'error',
    (event) => {
      const el = event.target
      if (!el || el.tagName !== 'IMG') return
      gyLoadedCovers.delete(el.currentSrc || el.src)
      el.classList.add('img-failed')
    },
    true
  )

  document.addEventListener('keydown', (event) => {
    if (player.open) {
      if (event.key === 'Escape') {
        if (document.fullscreenElement) return
        event.preventDefault()
        closePlayer()
        return
      }
      if (/^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(event.target.tagName)) return
      if (event.key === ' ') {
        event.preventDefault()
        if (videoEl.paused) videoEl.play().catch(() => {})
        else videoEl.pause()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 10)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        videoEl.currentTime = Math.min(videoEl.duration || Infinity, videoEl.currentTime + 10)
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        toggleFullscreen()
      } else if (event.key === 'm' || event.key === 'M') {
        videoEl.muted = !videoEl.muted
      } else if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        playNext()
      }
      return
    }
    if (event.key === 'Escape' && state.bookReader) {
      closeBookReader()
      return
    }
    if (event.key === 'Escape' && state.detail) closeDetail()
  })

/* ---------- 启动 ---------- */

async function init() {
  // 读取版本变体（desktop / car / mobile）并应用到 body
  const params = new URLSearchParams(window.location.search)
  const variant = params.get('variant') || 'desktop'
  document.body.classList.add(`variant-${variant}`)

  state.progress = loadProgress()
  state.history = loadHistory()
  state.searches = loadSearches()
  bindEvents()
  try {
    state.settings = await bridge.loadSettings()
    state.info = await bridge.info()
  } catch {
    /* 使用默认设置 */
  }
  if (!Array.isArray(state.settings.sources) || !state.settings.sources.length) {
    state.settings.sources = DEFAULT_SOURCES.map((source) => ({ ...source }))
    persistSettings()
  } else {
    if (state.settings.sources.some((source) => DEAD_SOURCE_APIS.includes(source?.api))) {
      const fallback = DEFAULT_SOURCES.find((source) => source.name === '非凡资源')
      state.settings.sources = state.settings.sources.map((source) =>
        DEAD_SOURCE_APIS.includes(source?.api) ? { ...fallback, enabled: source.enabled !== false } : source
      )
    }
    const additions = DEFAULT_SOURCES.filter(
      (source) =>
        !state.settings.sources.some(
          (item) => item?.api === source.api || (source.type === 'yh' && item?.type === 'yh')
        )
    )
    if (additions.length) {
      state.settings.sources = [...state.settings.sources, ...additions.map((source) => ({ ...source }))]
    }
    persistSettings()
  }
  render()
  // 启动即后台预热：榜单 + 歌单列表，进音乐厅立刻有内容
  window.setTimeout(() => {
    try {
      ttPrefetchChart()
      const tt = ttSlot()
      if (!tt.toplists.length && !tt.toplistsLoading) ttLoadToplists()
    } catch {
      /* 预取失败不影响主流程 */
    }
  }, 300)
  // 电台频道也在后台拉好，切过去不用等
  window.setTimeout(() => {
    try {
      const tv = tvSlot()
      if (!tv.loading && !tv.loaded) loadTv()
    } catch {
      /* 预取失败不影响主流程 */
    }
  }, 900)
  if (state.settings.folders.length) scan()
}

init()
