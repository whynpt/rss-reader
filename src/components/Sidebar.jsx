import { useMemo, useRef } from 'react';
import Icon from './Icon.jsx';
import usePanelFocus from './usePanelFocus.js';

const FILTERS = [
  { key: 'all', icon: 'inbox', label: '内容收件箱', count: 'total' },
  { key: 'unread', icon: 'unread', label: '未读内容', count: 'unread' },
  { key: 'starred', icon: 'star', label: '我的收藏', count: 'starred' },
];

export default function Sidebar({ feeds, stats, selection, onSelect, onAddFeed, onDeleteFeed, onRenameFeed, biliAuth, onBiliLogin, onBiliLogout, onBiliImportFollowings, open, onClose, inert }) {
  const panelRef = useRef(null);
  usePanelFocus(panelRef, onClose, open);
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const feed of feeds) {
      const category = feed.category || '未分类';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(feed);
    }
    return [...groups];
  }, [feeds]);
  const choose = (next) => { onSelect(next); onClose(); };

  return <>
    {open && <button className="sidebar-scrim" aria-label="关闭订阅菜单" onClick={onClose} tabIndex={-1} />}
    <aside id="subscription-nav" ref={panelRef} className={`sidebar ${open ? 'is-open' : ''}`} aria-label="订阅导航" inert={inert ? '' : undefined}>
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 9c7-12 15 9 22-3M3 16c7-12 15 9 22-3M3 23c7-12 15 9 22-3" /></svg>
        <span className="brand-name">Streamline</span>
        <button className="icon-btn drawer-close" aria-label="关闭订阅菜单" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="sidebar-scroll">
        <nav className="library-nav" aria-label="内容库">
          {FILTERS.map(filter => <button key={filter.key} className={`nav-item ${selection.type === filter.key && !selection.feedId && !selection.category ? 'active' : ''}`} aria-current={selection.type === filter.key && !selection.feedId && !selection.category ? 'page' : undefined} onClick={() => choose({ type: filter.key })}>
            <Icon name={filter.icon} /><span className="label">{filter.label}</span><span className="count">{stats[filter.count] || 0}</span>
          </button>)}
        </nav>
        <div className="nav-group-title"><span>我的订阅</span><span>{feeds.length}</span></div>
        <nav aria-label="订阅来源">
          {grouped.map(([category, list]) => <div key={category} className="feed-group">
            <button className={`category-label ${selection.category === category ? 'active' : ''}`} onClick={() => choose({ type: 'all', category })}>{category}<span>{list.length}</span></button>
            {list.map(feed => <div className={`feed-row ${selection.feedId === feed.id ? 'active' : ''}`} key={feed.id}>
              <button className="nav-item feed-select" onClick={() => choose({ type: 'all', feedId: feed.id, title: feed.title })} aria-current={selection.feedId === feed.id ? 'page' : undefined} title={feed.last_error ? `上次刷新失败：${feed.last_error}` : feed.title}>
                <span className="feed-symbol">{feed.kind === 'podcast' ? '播' : feed.kind === 'video' ? '视' : '文'}</span>
                <span className="label">{feed.title}</span>
                {feed.last_error && <span className="feed-error-dot" aria-label={`刷新失败：${feed.last_error}`} />}
                <span className="count">{feed.unread_count}</span>
              </button>
              <details className="feed-actions">
                <summary aria-label={`管理订阅：${feed.title}`}><Icon name="more" size={16} /></summary>
                <div className="feed-popover">
                  <button onClick={event => { event.currentTarget.closest('details').open = false; onRenameFeed(feed); }}>重命名与分类</button>
                  <button className="danger-text" onClick={event => { event.currentTarget.closest('details').open = false; onDeleteFeed(feed); }}>取消订阅</button>
                </div>
              </details>
            </div>)}
          </div>)}
          {!feeds.length && <p className="sidebar-empty">把喜欢的作者、频道和节目订阅到这里。</p>}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <button className="add-feed-btn" onClick={() => { onClose(); onAddFeed(); }}><Icon name="plus" size={18} />添加订阅</button>
        {biliAuth.loggedIn ? <div className="account-box">
          <div className="account-name"><Icon name="settings" size={18} /><span>{biliAuth.uname || 'B站账号'}</span><span className="connected-dot" title="已登录" /></div>
          <div className="account-actions"><button onClick={() => { onClose(); onBiliImportFollowings(); }}>导入关注</button><button onClick={onBiliLogout}>退出登录</button></div>
        </div> : <button className="account-login-btn" onClick={() => { onClose(); onBiliLogin(); }}><Icon name="settings" size={18} />登录 B站账号</button>}
        <p className="sidebar-caption">按照自己的节奏，读、看、听。<br />{stats.feeds || 0} 个订阅 · {stats.unread || 0} 条未读</p>
      </div>
    </aside>
  </>;
}
