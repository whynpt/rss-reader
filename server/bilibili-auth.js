import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

/**
 * B 站扫码登录
 *
 * 用的是官方 TV 端扫码登录协议（passport-tv-login），跟第三方 App 登录 B 站账号
 * 走的是同一套公开接口。目的只有一个：拿到登录态后，播放地址接口能给出免登录之外
 * 的清晰度（1080P，大会员账号更高），以及能拉取「我的关注」列表做批量订阅。
 *
 * 登录凭证（access_token/refresh_token/mid）落盘在 data/bilibili_auth.json，
 * 这个目录整体在 .gitignore 里，不会被提交。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_PATH = process.env.BILI_AUTH_PATH || join(ROOT, 'data', 'bilibili_auth.json');

// TV 端登录使用的 appkey/appsec，社区逆向文档长期公开记录的固定值
const TV_APP_KEY = '4409e2ce8ffd12b8';
const TV_APP_SEC = '59b43e04ad6965f34319062b478f83dd';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function signTv(params) {
  const withTs = { ...params, appkey: TV_APP_KEY, ts: Math.floor(Date.now() / 1000) };
  const sorted = Object.keys(withTs)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(withTs[k])}`)
    .join('&');
  const sign = createHash('md5').update(sorted + TV_APP_SEC).digest('hex');
  return `${sorted}&sign=${sign}`;
}

async function tvPost(path, params) {
  const body = signTv(params);
  const res = await fetch(`https://passport.bilibili.com${path}`, {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  return res.json();
}

/* ------------------------------ 凭证读写 ------------------------------ */

function readAuth() {
  try {
    return JSON.parse(readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeAuth(data) {
  mkdirSync(dirname(AUTH_PATH), { recursive: true });
  writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function clearAuth() {
  try {
    unlinkSync(AUTH_PATH);
  } catch {
    /* 文件本来就不存在，忽略 */
  }
}

/** 供其它模块（播放清晰度、关注列表）判断是否已登录、拿 access_token 用 */
export function getAuth() {
  const auth = readAuth();
  if (!auth) return null;
  if (auth.expiresAt && Date.now() > auth.expiresAt) return null;
  return auth;
}

export function getAuthStatus() {
  const auth = getAuth();
  if (!auth) return { loggedIn: false };
  return {
    loggedIn: true,
    mid: auth.mid,
    uname: auth.uname || null,
    face: auth.face || null,
    expiresAt: auth.expiresAt,
  };
}

/* ------------------------------ 登录流程 ------------------------------ */

// 二维码会话存内存即可，重启服务失效也无所谓，用户重新扫一次就行
const sessions = new Map();
const SESSION_TTL = 3 * 60_000;

export async function startLogin() {
  const json = await tvPost('/x/passport-tv-login/qrcode/auth_code', { local_id: '0' });
  if (json.code !== 0) throw new Error(`生成二维码失败：${json.message || json.code}`);

  const { auth_code: authCode, url } = json.data;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 260 });

  sessions.set(authCode, { createdAt: Date.now() });
  // 定期清理过期会话，避免内存里堆积扫码超时的记录
  for (const [code, session] of sessions) {
    if (Date.now() - session.createdAt > SESSION_TTL) sessions.delete(code);
  }

  return { authCode, qrDataUrl };
}

/** 拿到 access_token 之后，顺手查一次昵称/头像，登录成功提示更友好 */
async function fetchProfile(accessToken) {
  try {
    const q = signTv({ access_token: accessToken });
    const res = await fetch(`https://passport.bilibili.com/x/passport-tv-login/token/info?${q}`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    if (json.code === 0) return { uname: json.data?.uname, mid: json.data?.mid };
  } catch {
    /* 查不到昵称不影响登录本身，静默忽略 */
  }
  return {};
}

/**
 * 轮询登录状态。B 站的状态码：
 *  0      登录成功
 *  86039  二维码尚未确认（用户还没扫）
 *  86090  已扫描，等待用户在手机上点确认
 *  86038  二维码已失效（超过 3 分钟）
 */
export async function pollLogin(authCode) {
  if (!sessions.has(authCode)) return { status: 'expired' };

  const json = await tvPost('/x/passport-tv-login/qrcode/poll', { auth_code: authCode, local_id: '0' });

  if (json.code === 86039) return { status: 'pending' };
  if (json.code === 86090) return { status: 'scanned' };
  if (json.code === 86038) {
    sessions.delete(authCode);
    return { status: 'expired' };
  }
  if (json.code !== 0) {
    sessions.delete(authCode);
    return { status: 'error', message: json.message || `未知错误 ${json.code}` };
  }

  sessions.delete(authCode);
  const { access_token: accessToken, refresh_token: refreshToken, mid, expires_in: expiresIn } = json.data;
  const profile = await fetchProfile(accessToken);

  const auth = {
    accessToken,
    refreshToken,
    mid: mid || profile.mid,
    uname: profile.uname || null,
    expiresAt: Date.now() + (expiresIn || 30 * 24 * 3600) * 1000,
  };
  writeAuth(auth);

  return { status: 'success', uname: auth.uname, mid: auth.mid };
}
