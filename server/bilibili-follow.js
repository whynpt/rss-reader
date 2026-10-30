import { biliAppRequest } from './feeds.js';
import { getAuth } from './bilibili-auth.js';

/**
 * 拉取登录账号「我的关注」列表，用于批量订阅。
 * 默认关注列表是私密的，未登录或者不是本人查看会拿到空列表（这是 B 站的隐私机制，
 * 不是接口调用方式的问题），所以这里必须带上登录后的 access_token。
 */
export async function fetchFollowings() {
  const auth = getAuth();
  if (!auth?.accessToken) throw new Error('请先登录 B 站账号');

  const all = [];
  let page = 1;
  const pageSize = 50;
  const maxPages = 10; // 最多拉 500 个关注，通常够用；真有更多可以之后再分页加载

  while (page <= maxPages) {
    const data = await biliAppRequest('https://app.bilibili.com/x/v2/relation/followings', {
      vmid: auth.mid,
      access_token: auth.accessToken,
      ps: pageSize,
      pn: page,
    });

    const list = data?.list || [];
    all.push(
      ...list.map((u) => ({
        mid: u.mid,
        name: u.uname,
        face: u.face,
        sign: u.sign || '',
      }))
    );

    if (list.length < pageSize) break;
    page += 1;
  }

  return all;
}
