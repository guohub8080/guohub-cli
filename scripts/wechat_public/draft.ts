import { isEmpty } from "lodash-es";
import { readFileSync } from "node:fs";
import { readClipboard } from "#common_js/clipboard.js";
import { guohub_json_print, guohub_error_print, guohub_text_print } from "#common_js/log.js";
import { getAccessToken } from "./api.js";

const API_BASE = "https://api.weixin.qq.com/cgi-bin";

async function listDrafts(account: string, offset = 0, count = 20) {
  const token = await getAccessToken(account);
  const resp = await fetch(`${API_BASE}/draft/batchget?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, count, no_content: 0 }),
  });
  const data = (await resp.json()) as Record<string, unknown>;

  if (data.errcode && data.errcode !== 0) {
    guohub_error_print(`获取草稿列表失败: ${JSON.stringify(data)}`);
  }

  const items = (data.item ?? []) as Record<string, unknown>[];
  const totalCount = Number(data.total_count ?? 0);

  const list = items.map(item => {
    const content = item.content as Record<string, unknown> | undefined;
    const newsItem = content?.news_item as Record<string, unknown>[] | undefined;
    const first = newsItem?.[0] ?? {};
    return {
      media_id: item.media_id,
      title: first.title || "(无标题)",
      author: first.author || "",
      digest: first.digest || "",
      update_time: item.update_time,
      url: first.url || "",
      thumb_media_id: first.thumb_media_id || "",
    };
  });

  guohub_json_print({ total_count: totalCount, items: list });
}

async function getDraft(account: string, mediaId: string) {
  const token = await getAccessToken(account);
  const resp = await fetch(`${API_BASE}/draft/get?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });
  const data = (await resp.json()) as Record<string, unknown>;

  if (data.errcode && data.errcode !== 0) {
    guohub_error_print(`获取草稿失败: ${JSON.stringify(data)}`);
  }

  const newsItem = (data.news_item ?? []) as Record<string, unknown>[];
  guohub_json_print({ media_id: mediaId, news_item: newsItem });
}

async function addDraft(account: string, title: string, content: string, thumbMediaId: string, author?: string, digest?: string) {
  const token = await getAccessToken(account);
  const article: Record<string, unknown> = {
    title,
    content,
    thumb_media_id: thumbMediaId,
    ...(author ? { author } : {}),
    ...(digest ? { digest } : {}),
  };

  const resp = await fetch(`${API_BASE}/draft/add?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articles: [article] }),
  });
  const data = (await resp.json()) as Record<string, unknown>;

  if (data.errcode && data.errcode !== 0) {
    guohub_error_print(`新建草稿失败: ${JSON.stringify(data)}`);
  }

  guohub_json_print({ media_id: data.media_id, created: true });
}

async function updateDraft(
  account: string,
  mediaId: string,
  index: number,
  title?: string,
  content?: string,
  thumbMediaId?: string,
  author?: string,
  digest?: string,
) {
  const token = await getAccessToken(account);

  // 获取现有内容
  const getResp = await fetch(`${API_BASE}/draft/get?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });
  const existing = (await getResp.json()) as Record<string, unknown>;

  if (existing.errcode && existing.errcode !== 0) {
    guohub_error_print(`获取草稿失败: ${JSON.stringify(existing)}`);
  }

  const newsItem = (existing.news_item as Record<string, unknown>[])[index] || {};

  const article: Record<string, unknown> = {
    title: title ?? newsItem.title ?? "",
    content: content ?? newsItem.content ?? "",
    thumb_media_id: thumbMediaId ?? newsItem.thumb_media_id ?? "",
    author: author ?? newsItem.author ?? "",
    digest: digest ?? newsItem.digest ?? "",
  };

  const resp = await fetch(`${API_BASE}/draft/update?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId, index, articles: article }),
  });
  const data = (await resp.json()) as Record<string, unknown>;

  if (data.errcode && data.errcode !== 0) {
    guohub_error_print(`更新草稿失败: ${JSON.stringify(data)}`);
  }

  guohub_text_print(`草稿 ${mediaId} 已更新`);
}

async function deleteDraft(account: string, mediaId: string) {
  const token = await getAccessToken(account);
  const resp = await fetch(`${API_BASE}/draft/delete?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });
  const data = (await resp.json()) as Record<string, unknown>;

  if (data.errcode && data.errcode !== 0) {
    guohub_error_print(`删除草稿失败: ${JSON.stringify(data)}`);
  }

  guohub_text_print(`草稿 ${mediaId} 已删除`);
}

export async function main(args: string[]) {
  let account = "";
  let mediaId = "";
  let title = "";
  let content = "";
  let thumbMediaId = "";
  let author = "";
  let digest = "";
  let index = 0;
  let offset = 0;
  let count = 20;

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--account": account = args[++i]; break;
      case "--media-id": mediaId = args[++i]; break;
      case "--title": title = args[++i]; break;
      case "--content": content = args[++i]; break;
      case "--content-from-clipboard": content = readClipboard(); break;
      case "--content-from-file": content = readFileSync(args[++i], "utf-8"); break;
      case "--thumb-media-id": thumbMediaId = args[++i]; break;
      case "--author": author = args[++i]; break;
      case "--digest": digest = args[++i]; break;
      case "--index": index = parseInt(args[++i]); break;
      case "--offset": offset = parseInt(args[++i]); break;
      case "--count": count = parseInt(args[++i]); break;
      default: positional.push(args[i]);
    }
  }

  const command = positional[0];

  if (!account) {
    const { loadConfig } = await import("./api.js");
    const config = loadConfig();
    const defaults = config.defaults as Record<string, unknown> | undefined;
    if (defaults?.default_account) account = String(defaults.default_account);
  }

  if (isEmpty(account)) guohub_error_print("未指定账户且无默认账户，请用 --account 指定或先 wechat-account setup");

  try {
    switch (command) {
      case "list":
        await listDrafts(account, offset, count);
        break;
      case "get": {
        if (isEmpty(mediaId)) guohub_error_print("用法: wechat-draft get --media-id <ID>");
        await getDraft(account, mediaId);
        break;
      }
      case "add": {
        if (isEmpty(title) || isEmpty(content) || isEmpty(thumbMediaId)) {
          guohub_error_print("用法: wechat-draft add --title <标题> --content <HTML内容> --thumb-media-id <封面图ID> [--author <作者>] [--digest <摘要>]");
        }
        await addDraft(account, title, content, thumbMediaId, author || undefined, digest || undefined);
        break;
      }
      case "update": {
        if (isEmpty(mediaId)) {
          guohub_error_print("用法: wechat-draft update --media-id <ID> [--title <标题>] [--content <HTML内容>] [--thumb-media-id <封面图ID>] [--index <0>] [--author <作者>] [--digest <摘要>]");
        }
        await updateDraft(account, mediaId, index, title || undefined, content || undefined, thumbMediaId || undefined, author || undefined, digest || undefined);
        break;
      }
      case "remove": {
        if (isEmpty(mediaId)) guohub_error_print("用法: wechat-draft remove --media-id <ID>");
        await deleteDraft(account, mediaId);
        break;
      }
      default:
        guohub_error_print("用法: wechat-draft <list|get|add|update|remove> [选项]");
    }
  } catch (e: any) {
    guohub_error_print(`错误: ${e.message}`);
  }
}
