import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, probeDirectMedia } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import { EntryList } from './components/EntryList.jsx';
import EntryDetail from './components/EntryDetail.jsx';
import AddFeedDialog from './components/AddFeedDialog.jsx';
import BilibiliLoginDialog from './components/BilibiliLoginDialog.jsx';
import BilibiliFollowingsDialog from './components/BilibiliFollowingsDialog.jsx';
import PersistentAudioPlayer from './components/PersistentAudioPlayer.jsx';
import { usePlayback } from './components/PlaybackProvider.jsx';
import Icon from './components/Icon.jsx';

const PAGE_SIZE = 60;
const EMPTY_STATS = { total: 0, unread: 0, starred: 0, videos: 0, feeds: 0 };
const EMPTY_COUNTS = { total: 0, article: 0, video: 0, podcast: 0, unread: 0 };
const TITLES = { all: '内容收件箱', unread: '未读内容', starred: '我的收藏' };
const TYPES = [{ key: 'all', label: '全部' }, { key: 'article', label: '文章' }, { key: 'video', label: '视频' }, { key: 'podcast', label: '播客' }];

export default function App() {
  const [feeds, setFeeds] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [selection, setSelection] = useState({ type: 'all' });
  const [mediaType, setMediaType] = useState('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [appending, setAppending] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState(null);
  const [pending, setPending] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [directMedia, setDirectMedia] = useState(null);
  const [biliAuth, setBiliAuth] = useState({ loggedIn: false });
  const [biliLoginOpen, setBiliLoginOpen] = useState(false);
  const [biliFollowingsOpen, setBiliFollowingsOpen] = useState(false);
  const playback = usePlayback();
  const contentRef = useRef(null);
  const searchRef = useRef(null);
  const entriesRef = useRef(entries);
  const selectedRef = useRef(selected);
  const requestRef = useRef(0);
  const pendingRef = useRef(new Set());
  entriesRef.current = entries;
  selectedRef.current = selected;
  const scope = useMemo(() => ({ filter: selection.type, feedId: selection.feedId, category: selection.category, q: debouncedQuery }), [selection, debouncedQuery]);
  const scopeKey = JSON.stringify(scope);
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const listKey = JSON.stringify({ ...scope, mediaType });
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;
  const flash = useCallback(message => setToast(message), []);
  const closeDetail = useCallback(() => setSelected(null), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const openBiliLogin = useCallback(() => setBiliLoginOpen(true), []);

  const loadSidebar = useCallback(async () => {
    const [nextFeeds, nextStats] = await Promise.all([api.feeds(), api.stats()]);
    setFeeds(nextFeeds); setStats(nextStats);
  }, []);
  const refreshOverview = useCallback(async () => {
    const key = JSON.stringify(scope);
    const [, nextCounts] = await Promise.all([loadSidebar(), api.entryCounts(scope)]);
    if (key === scopeKeyRef.current) setCounts(nextCounts);
  }, [loadSidebar, scope]);
  const loadEntries = useCallback(async (reset = true, scroll = false) => {
    const key = JSON.stringify({ ...scope, mediaType });
    if (key !== listKeyRef.current) return;
    const requestId = ++requestRef.current;
    const isCurrent = () => requestId === requestRef.current && key === listKeyRef.current;
    setLoading(true); setAppending(!reset); setLoadError(null);
    try {
      const [rows, nextCounts] = await Promise.all([
        api.entries({ ...scope, mediaType, limit: PAGE_SIZE, offset: reset ? 0 : entriesRef.current.length }),
        api.entryCounts(scope),
      ]);
      if (!isCurrent()) return;
      setEntries(previous => reset ? rows : [...previous, ...rows]);
      setCounts(nextCounts); setHasMore(rows.length === PAGE_SIZE);
      if (scroll) contentRef.current?.scrollTo({ top: 0 });
    } catch (err) {
      if (isCurrent()) setLoadError(err.message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [scope, mediaType]);

  useEffect(() => { loadSidebar().catch(err => flash(err.message)); }, [loadSidebar, flash]);
  useEffect(() => { probeDirectMedia().then(setDirectMedia); api.bilibiliLoginStatus().then(setBiliAuth).catch(() => {}); }, []);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { loadEntries(true, true); return () => { ++requestRef.current; }; }, [loadEntries]);
  useEffect(() => {
    const breakpoint = window.matchMedia('(min-width: 768px)');
    const handleChange = () => { if (breakpoint.matches) setSidebarOpen(false); };
    breakpoint.addEventListener('change', handleChange);
    return () => breakpoint.removeEventListener('change', handleChange);
  }, []);

  const patchEntry = useCallback((id, patch) => {
    setEntries(previous => previous.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
    setSelected(previous => previous?.id === id ? { ...previous, ...patch } : previous);
  }, []);
  const saveFlag = useCallback(async (entry, field, value) => {
    const key = `${entry.id}:${field}`;
    if (pendingRef.current.has(key) || entry[field] === value) return;
    pendingRef.current.add(key);
    setPending(new Set([...pendingRef.current].map(item => Number(item.split(':')[0]))));
    const oldValue = entry[field];
    patchEntry(entry.id, { [field]: value });
    try {
      await (field === 'is_read' ? api.setRead(entry.id, !!value) : api.setStar(entry.id, !!value));
    } catch (err) {
      patchEntry(entry.id, { [field]: oldValue });
      flash(`未能保存操作：${err.message}`);
      loadSidebar().catch(() => {});
      return;
    } finally {
      pendingRef.current.delete(key);
      setPending(new Set([...pendingRef.current].map(item => Number(item.split(':')[0]))));
    }
    refreshOverview().catch(err => flash(`状态已保存，计数更新失败：${err.message}`));
    if ((scope.filter === 'unread' && field === 'is_read') || (scope.filter === 'starred' && field === 'is_starred')) loadEntries(true);
  }, [patchEntry, refreshOverview, scope.filter, loadEntries, loadSidebar, flash]);
  const openEntry = useCallback(entry => {
    const known = entriesRef.current.find(item => item.id === entry.id) || (selectedRef.current?.id === entry.id ? selectedRef.current : entry);
    setSelected(known);
    if (!known.is_read) saveFlag(known, 'is_read', 1);
  }, [saveFlag]);
  const toggleStar = useCallback(entry => saveFlag(entry, 'is_starred', entry.is_starred ? 0 : 1), [saveFlag]);
  const toggleRead = useCallback(entry => saveFlag(entry, 'is_read', entry.is_read ? 0 : 1), [saveFlag]);

  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const { added, results } = await api.refreshAll();
      await Promise.all([loadSidebar(), loadEntries(true)]);
      const failed = results.filter(result => result.error).length;
      flash(`刷新完成，新增 ${added} 条内容${failed ? `；${failed} 个订阅暂未更新，可在侧栏查看原因。` : '。'}`);
    } catch (err) { flash(`刷新失败：${err.message}`); }
    finally { setRefreshing(false); }
  }, [refreshing, loadSidebar, loadEntries, flash]);

  const addFeed = async (url, category, name) => {
    const result = await api.addFeed(url, category);
    let feed = result.feed;
    if (name) {
      try { feed = await api.updateFeed(feed.id, { title: name }); }
      catch (err) { flash(`订阅已添加，名称保存失败：${err.message}`); }
    }
    await loadSidebar();
    setMediaType('all'); setQuery(''); setDebouncedQuery('');
    setSelection({ type: 'all', feedId: feed.id, title: feed.title });
    flash(`已订阅「${feed.title}」，收到了 ${result.added} 条内容。`);
  };
  const deleteFeed = async feed => {
    if (!confirm(`确定取消订阅「${feed.title}」吗？该源下的所有条目会一并删除。`)) return;
    try {
      await api.deleteFeed(feed.id);
      if (playback.activeEntry?.feed_id === feed.id) playback.stop();
      if (selection.feedId === feed.id) setSelection({ type: 'all' });
      else await loadEntries(true);
      await loadSidebar(); flash('已取消订阅');
    } catch (err) { flash(`取消订阅失败：${err.message}`); }
  };
  const renameFeed = async feed => {
    const title = prompt('重命名订阅', feed.title);
    if (title === null || !title.trim()) return;
    const category = prompt('修改分类', feed.category);
    if (category === null) return;
    try { await api.updateFeed(feed.id, { title: title.trim(), category: category.trim() }); await Promise.all([loadSidebar(), loadEntries(true)]); }
    catch (err) { flash(`修改失败：${err.message}`); }
  };
  const markAllRead = async () => {
    setMarking(true);
    try {
      const { changed } = await api.markAllRead({ ...scope, mediaType });
      await Promise.all([loadSidebar(), loadEntries(true)]);
      flash(`已将当前筛选中的 ${changed} 条内容标为已读。`);
    } catch (err) { flash(`操作失败：${err.message}`); }
    finally { setMarking(false); }
  };
  const handleBiliLogout = async () => {
    if (!confirm('确定退出 B站账号吗？')) return;
    try { await api.bilibiliLogout(); setBiliAuth({ loggedIn: false }); flash('已退出 B站账号'); }
    catch (err) { flash(err.message); }
  };

  useEffect(() => {
    const onKey = event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || dialogOpen || biliLoginOpen || biliFollowingsOpen || sidebarOpen) return;
      if (/^(INPUT|TEXTAREA|SELECT|VIDEO|AUDIO)$/.test(event.target.tagName) || event.target.isContentEditable) return;
      const index = selected ? entries.findIndex(entry => entry.id === selected.id) : -1;
      if (['j', 'ArrowDown', 'k', 'ArrowUp'].includes(event.key) && entries.length) {
        event.preventDefault();
        const next = ['j', 'ArrowDown'].includes(event.key) ? Math.min(index + 1, entries.length - 1) : Math.max(index - 1, 0);
        openEntry(entries[next]);
      } else if (event.key === 'Escape') closeDetail();
      else if (event.key === 's' && selected) toggleStar(selected);
      else if (event.key === 'm' && selected) toggleRead(selected);
      else if (event.key === 'o' && selected?.link) window.open(selected.link, '_blank', 'noreferrer');
      else if (event.key === 'r') refreshAll();
      else if (event.key === 'n') setDialogOpen(true);
      else if (event.key === '/' && !selected) { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries, selected, openEntry, toggleRead, toggleStar, closeDetail, refreshAll, dialogOpen, biliLoginOpen, biliFollowingsOpen, sidebarOpen]);

  const currentFeed = feeds.find(feed => feed.id === selection.feedId);
  const title = currentFeed?.title || selection.category || selection.title || TITLES[selection.type];
  const total = counts[mediaType === 'all' ? 'total' : mediaType] || 0;
  const currentUnread = counts[mediaType === 'all' ? 'unread' : `unread_${mediaType}`] || 0;
  const showSkeleton = loading && !appending;
  const description = currentFeed ? currentFeed.description || `${currentFeed.total_count} 条内容，按照自己的节奏慢慢看。` : selection.type === 'starred' ? '留住那些想再读、再看、再听一遍的内容。' : selection.type === 'unread' ? '还没来得及打开的，值得留一点时间。' : '让值得停留的内容，有一个安静的地方。';

  return <div className={`app ${playback.activeEntry ? 'has-player' : ''}`}>
    <a className="skip-link" href="#main">跳到内容</a>
    <Sidebar feeds={feeds} stats={stats} selection={selection} onSelect={setSelection} onAddFeed={() => setDialogOpen(true)} onDeleteFeed={deleteFeed} onRenameFeed={renameFeed} biliAuth={biliAuth} onBiliLogin={openBiliLogin} onBiliLogout={handleBiliLogout} onBiliImportFollowings={() => setBiliFollowingsOpen(true)} open={sidebarOpen} onClose={closeSidebar} inert={!!selected} />
    <main id="main" className="main" tabIndex={-1} inert={selected || sidebarOpen ? '' : undefined}>
      <div className="content" ref={contentRef}>
        <div className="inbox-container">
          <div className="topbar"><button className="icon-btn menu-toggle" aria-label="打开订阅菜单" aria-expanded={sidebarOpen} aria-controls="subscription-nav" onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button><p className="breadcrumb">个人内容库 / {selection.feedId ? '订阅' : selection.category ? '分类' : '收件箱'}</p><div className="search-box"><Icon name="search" size={18} /><input ref={searchRef} type="search" aria-label="搜索标题、作者或订阅" placeholder="搜索标题、作者或订阅" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-btn" aria-label="清空搜索" onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}</div></div>
          <header className="inbox-heading"><div><h1>{title}</h1><p>{description}</p></div><div className="inbox-tools"><button className="tool-btn mark-all-btn" aria-label="将当前筛选全部标为已读" title="仅标记当前筛选结果" onClick={markAllRead} disabled={loading || marking || !currentUnread}><Icon name="check" size={18} /><span>{marking ? '正在标记…' : '全部已读'}</span></button><button className="icon-btn" aria-label="刷新全部订阅" onClick={refreshAll} disabled={refreshing}><Icon name="refresh" className={refreshing ? 'spin' : ''} /></button></div></header>
          <nav className="content-types" aria-label="按内容类型筛选">{TYPES.map(type => <button key={type.key} aria-pressed={mediaType === type.key} className={mediaType === type.key ? 'active' : ''} onClick={() => setMediaType(type.key)}>{type.label}<span>{counts[type.key === 'all' ? 'total' : type.key] || 0}</span></button>)}</nav>
          <div className="list-caption"><span>{debouncedQuery ? `搜索「${debouncedQuery}」` : selection.type === 'starred' ? '好内容，值得再回来' : '按发布时间 · 从新到旧'}</span><span role="status" aria-live="polite">{loading ? '正在加载…' : `${total} 条内容`}</span></div>
          {loadError ? <div className="empty" role="alert"><Icon name="refresh" size={32} /><h2>内容暂时没有加载出来</h2><p>{loadError}</p><button className="tool-btn" onClick={() => loadEntries(true)}>重新加载</button></div> : showSkeleton ? <div className="feed-skeleton" aria-label="正在加载内容">{[0, 1, 2].map(index => <div className="skeleton-entry" key={index}><i /><i /><i /></div>)}</div> : entries.length ? <EntryList entries={entries} selectedId={selected?.id} onOpen={openEntry} onToggleStar={toggleStar} onToggleRead={toggleRead} pending={pending} /> : <div className="empty"><Icon name={debouncedQuery ? 'search' : selection.type === 'starred' ? 'star' : 'inbox'} size={38} /><h2>{debouncedQuery ? '没有找到这份内容' : !feeds.length ? '从一份喜欢的内容开始' : selection.type === 'starred' ? '给好内容留个位置' : selection.type === 'unread' ? '未读已清空，慢慢来' : '这里还没有内容'}</h2><p>{debouncedQuery ? `没有与「${debouncedQuery}」匹配的内容，试试其他关键词。` : !feeds.length ? '订阅知乎文章、B站频道或播客，把喜欢的内容放在一起。' : '可以切换内容类型，或刷新订阅，看看有没有新内容。'}</p>{query ? <button className="tool-btn" onClick={() => setQuery('')}>清空搜索</button> : !feeds.length ? <button className="btn-primary" onClick={() => setDialogOpen(true)}>添加第一份订阅</button> : null}</div>}
          {hasMore && !loadError && <button className="load-more" disabled={loading} onClick={() => loadEntries(false)}>{loading ? '正在加载…' : '加载更多内容'}</button>}
          {!hasMore && entries.length > 0 && !loading && <p className="end-note">暂时看到这里，也很好。</p>}
        </div>
      </div>
    </main>
    {selected && <EntryDetail key={selected.id} entry={selected} directMedia={directMedia} biliLoggedIn={biliAuth.loggedIn} onBiliLogin={openBiliLogin} onClose={closeDetail} onToggleStar={toggleStar} onToggleRead={toggleRead} pending={pending.has(selected.id)} onContentLoaded={(id, content) => patchEntry(id, { content })} />}
    <PersistentAudioPlayer onOpen={openEntry} />
    <AddFeedDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSubmit={addFeed} />
    <BilibiliLoginDialog open={biliLoginOpen} onClose={() => setBiliLoginOpen(false)} onLoggedIn={({ uname, mid }) => { setBiliAuth({ loggedIn: true, uname, mid }); setBiliLoginOpen(false); flash('B站账号已登录，视频会重新获取可用清晰度。'); }} />
    <BilibiliFollowingsDialog open={biliFollowingsOpen} onClose={() => setBiliFollowingsOpen(false)} onImported={() => { loadSidebar().catch(err => flash(err.message)); loadEntries(true); }} />
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-btn" aria-label="关闭提示" onClick={() => setToast(null)}><Icon name="close" size={16} /></button></div>}
  </div>;
}
