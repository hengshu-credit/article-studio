//#region src/native-images.js
/** Serialized into the platform tab. All file handling runs against its own editor. */
async function uploadInEditor(image, cover, expectedOrigin, timeout = 3e4, requireEmptyDraft = false) {
	try {
		return {
			ok: true,
			url: await upload()
		};
	} catch (error) {
		return {
			ok: false,
			error: error.message
		};
	}
	async function upload() {
		if (location.origin !== expectedOrigin) throw new Error("草稿页已跳转，请重新登录目标平台");
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		async function wait(read, limit) {
			const until = Date.now() + limit;
			do {
				const result = read();
				if (result) return result;
				await sleep(150);
			} while (Date.now() < until);
			return null;
		}
		const transfer = new DataTransfer();
		let blob;
		if (image.data) {
			const comma = image.data.indexOf(",");
			const mime = /^data:(image\/[\w.+-]+)(?:;charset=[\w-]+)?;base64$/i.exec(image.data.slice(0, comma))?.[1];
			if (!mime) throw new Error("图片数据格式错误");
			blob = new Blob([Uint8Array.from(atob(image.data.slice(comma + 1)), (c) => c.charCodeAt(0))], { type: mime });
		} else {
			const url = new URL(image.sourceUrl);
			if (!["http:", "https:"].includes(url.protocol)) throw new Error("外部图片地址无效");
			try {
				const response = await fetch(url, {
					credentials: "omit",
					signal: AbortSignal.timeout(5e3)
				});
				if (response.ok) {
					const original = await response.blob();
					if (original.size && original.type.startsWith("image/")) blob = original;
				}
			} catch {}
			if (!blob) {
				if (cover) throw new Error("请下载封面原图，在平台草稿中选择文件上传");
				const img = document.createElement("img");
				img.src = url.href;
				transfer.setData("text/html", img.outerHTML);
			}
		}
		if (blob) {
			const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1].split("+")[0];
			const filename = image.name.replace(/[\\/:*?"<>|\r\n]/g, "-").slice(0, 120);
			transfer.items.add(new File([blob], `${filename}.${ext}`, { type: blob.type }));
		}
		function remote(raw, doc) {
			if (!raw || raw.startsWith("#")) return null;
			try {
				const url = new URL(raw, doc.baseURI);
				return /^https?:$/.test(url.protocol) && (blob || url.href !== image.sourceUrl) ? url.href : null;
			} catch {
				return null;
			}
		}
		const probes = /* @__PURE__ */ new Map();
		function loadable(raw, doc) {
			const url = remote(raw, doc);
			if (!url) return null;
			if (!probes.has(url)) {
				const img = doc.createElement("img");
				img.src = url;
				probes.set(url, img);
			}
			const img = probes.get(url);
			return img.complete && img.naturalWidth > 0 ? url : null;
		}
		if (cover) {
			const control = await wait(() => [...document.querySelectorAll("input[type=file]")].find((input) => !input.disabled && (input.closest("[class*=\"cover\" i],[id*=\"cover\" i],[data-testid*=\"cover\" i]") || /封面|cover/i.test([
				input.name,
				input.getAttribute("aria-label"),
				...Array.from(input.labels || [], (label) => label.textContent)
			].join(" ")))), 1500);
			if (!control) throw new Error("请在平台草稿中打开封面设置，选择封面原图");
			const area = control.closest("[class*=\"cover\" i],[id*=\"cover\" i],[data-testid*=\"cover\" i]") || control.parentElement;
			const urls = () => Array.from(area.querySelectorAll("img"), (img) => remote(img.getAttribute("src"), document)).filter(Boolean);
			const previous = new Set(urls());
			control.files = transfer.files;
			control.dispatchEvent(new Event("input", { bubbles: true }));
			control.dispatchEvent(new Event("change", { bubbles: true }));
			if (!await wait(() => urls().some((url) => !previous.has(url) && loadable(url, document)), Math.min(timeout, 8e3))) throw new Error("封面原图已交给上传控件，请在平台草稿中确认上传或裁剪结果");
			return;
		}
		function findEditor() {
			const documents = [document, ...Array.from(document.querySelectorAll("iframe"), (frame) => frame.contentDocument).filter(Boolean)];
			for (const selector of [
				".CodeMirror",
				".ProseMirror[contenteditable=true],.public-DraftEditor-content,.cm-content,.vditor-reset[contenteditable=true],.editor__inner[contenteditable=true]",
				"[contenteditable=true],textarea"
			]) for (const doc of documents) {
				const candidates = Array.from(doc.querySelectorAll(selector)).filter((el) => el.getClientRects().length && !el.disabled && !el.readOnly && !el.closest("[class*=\"title\" i],[id*=\"title\" i],textarea.CodeMirror-input") && !/标题|title|摘要|描述|summary|description|搜索|search/i.test([
					el.id,
					el.name,
					el.getAttribute("placeholder"),
					el.getAttribute("aria-label"),
					el.getAttribute("data-placeholder")
				].join(" ")));
				if (candidates.length === 1) return candidates[0];
			}
			return null;
		}
		const editor = await wait(findEditor, Math.min(timeout, 1e4));
		if (!editor) throw new Error("未找到平台的正文图片上传入口");
		const doc = editor.ownerDocument;
		const cm = editor.CodeMirror;
		const textarea = editor.tagName === "TEXTAREA";
		const target = cm?.getInputField() || editor;
		const readText = () => cm ? cm.getValue() : textarea ? editor.value : editor.textContent;
		const before = readText();
		const previousImages = new Set(editor.querySelectorAll("img"));
		const previousFigures = new Set(editor.querySelectorAll("figure"));
		if (requireEmptyDraft && (before.trim() || previousImages.size || doc.querySelector("textarea.title-input__inner")?.value)) throw new Error("已打开的草稿有内容，请在空白草稿中上传图片");
		target.focus();
		function selectRange(range) {
			const sel = doc.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		}
		if (cm) cm.setCursor(cm.posFromIndex(before.length));
		else if (textarea) editor.setSelectionRange(before.length, before.length);
		else {
			const range = doc.createRange();
			range.selectNodeContents(editor);
			range.collapse(false);
			selectRange(range);
		}
		const bodyInput = Array.from(doc.querySelectorAll("input[type=file][accept*=\"image\"]")).find((input) => !input.disabled && input.closest(".editor-toolbar,.vditor-toolbar,.bytemd-toolbar,[role=toolbar]") && !input.closest("[class*=\"cover\" i],[id*=\"cover\" i]"));
		if (blob && bodyInput) {
			bodyInput.files = transfer.files;
			bodyInput.dispatchEvent(new Event("change", { bubbles: true }));
		} else target.dispatchEvent(new ClipboardEvent("paste", {
			bubbles: true,
			cancelable: true,
			clipboardData: transfer
		}));
		const uploaded = await wait(() => {
			if (!cm && !textarea) for (const img of editor.querySelectorAll("img")) {
				if (previousImages.has(img)) continue;
				const url = loadable(img.getAttribute("data-src"), doc) || loadable(img.getAttribute("src"), doc);
				if (url) return {
					img,
					url
				};
			}
			const text = readText();
			if (!text.startsWith(before)) return null;
			const added = text.slice(before.length);
			const match = /^\s*!\[(?:\\.|[^\]])*\]\(\s*(?:<([^>]+)>|([^\s]+))\s*(?:["'][^"']*["'])?\s*\)\s*$/.exec(added);
			const url = loadable(match?.[1] || match?.[2], doc);
			return url ? {
				added,
				url
			} : null;
		}, timeout);
		if (!uploaded) throw new Error(blob ? "平台未返回可保存的图片地址，请在目标编辑器检查文件粘贴和上传结果" : "平台未能转存这张外链图片，请下载后从素材库插入并重新分发");
		if (cm) cm.replaceRange("", cm.posFromIndex(before.length), cm.posFromIndex(readText().length));
		else if (textarea) {
			editor.setRangeText("", before.length, editor.value.length, "end");
			editor.dispatchEvent(new Event("input", { bubbles: true }));
		} else {
			const range = doc.createRange();
			if (uploaded.img) {
				const figure = uploaded.img.closest("figure");
				range.selectNode(figure && !previousFigures.has(figure) && editor.contains(figure) ? figure : uploaded.img);
			} else {
				const walker = doc.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
				let offset = before.length;
				let node;
				while ((node = walker.nextNode()) && offset > node.length) offset -= node.length;
				if (!node) throw new Error("平台图片插入位置已变化");
				range.selectNodeContents(editor);
				range.setStart(node, offset);
			}
			selectRange(range);
			doc.execCommand("delete");
		}
		if (uploaded.img?.isConnected || readText().trim() !== before.trim()) throw new Error("平台已上传图片，正文编辑区仍有临时内容，请检查草稿后重试");
		return uploaded.url;
	}
}
async function resolveBodyImages(content, upload, importsHtmlImages = false) {
	const { images, ...post } = content;
	const urls = /* @__PURE__ */ new Map();
	for (const image of images || []) {
		if (!post.body?.includes(image.key) && !post.markdown?.includes(image.key)) continue;
		if (importsHtmlImages && image.sourceUrl) urls.set(image.key, image.sourceUrl);
		else {
			const url = new URL(await upload(image));
			if (!["https:", "http:"].includes(url.protocol)) throw new Error("平台图片地址无效");
			urls.set(image.key, url.href.replace(/[()]/g, (c) => c === "(" ? "%28" : "%29"));
		}
	}
	if (!urls.size) return post;
	const keys = [...urls.keys()].map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const pattern = new RegExp(keys.join("|"), "g");
	const htmlUrl = (key) => urls.get(key).replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
	post.body = post.body?.replace(pattern, htmlUrl);
	post.wechatHtml = post.wechatHtml?.replace(pattern, htmlUrl);
	post.markdown = post.markdown?.replace(pattern, (key) => urls.get(key));
	return post;
}
var LOGIN_CHECK_CONFIG = {
	juejin: {
		api: "https://api.juejin.cn/user_api/v1/user/get",
		method: "GET",
		checkLogin: (response) => response?.err_no === 0 && response?.data?.user_id,
		getUserInfo: (response) => ({
			username: response?.data?.user_name,
			avatar: response?.data?.avatar_large
		})
	},
	zhihu: {
		api: "https://www.zhihu.com/api/v4/me",
		method: "GET",
		checkLogin: (response) => response?.id,
		getUserInfo: (response) => ({
			username: response?.name,
			avatar: response?.avatar_url
		})
	},
	toutiao: {
		api: "https://mp.toutiao.com/mp/agw/creator_center/user_info?app_id=1231",
		method: "GET",
		checkLogin: (response) => response?.code === 0 && response?.name,
		getUserInfo: (response) => ({
			username: response?.name,
			avatar: response?.avatar_url
		})
	},
	baijiahao: {
		api: "https://baijiahao.baidu.com/builder/app/appinfo",
		method: "GET",
		checkLogin: (response) => response?.errno === 0 && response?.data?.user?.name,
		getUserInfo: (response) => ({
			username: response?.data?.user?.name,
			avatar: response?.data?.user?.avatar
		})
	},
	douyin: {
		api: "https://creator.douyin.com/web/api/media/user/info/",
		method: "GET",
		checkLogin: (response) => response?.status_code === 0 && (response?.user?.uid || response?.user_info?.uid),
		getUserInfo: (response) => ({
			username: response?.user?.nickname || response?.user_info?.nickname,
			avatar: response?.user?.avatar_thumb?.url_list?.[0] || response?.user_info?.avatar_thumb?.url_list?.[0]
		})
	}
};
//#endregion
//#region ../../packages/detection/src/utils.js
/**
* Convert an avatar URL to a base64 data URL to bypass CORS/ORB blocking.
* The service worker can fetch with a custom Referer header.
* @param {string} avatarUrl - The original avatar URL
* @param {string} referer - The Referer header to use for the fetch
* @returns {Promise<string>} - base64 data URL, or original URL if conversion fails
*/
async function convertAvatarToBase64(avatarUrl, referer) {
	try {
		const imgResp = await fetch(avatarUrl, { headers: { Referer: referer } });
		if (imgResp.ok) {
			const blob = await imgResp.blob();
			const buffer = await blob.arrayBuffer();
			const bytes = new Uint8Array(buffer);
			let binary = "";
			for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
			const base64 = btoa(binary);
			return `data:${blob.type || "image/jpeg"};base64,${base64}`;
		}
	} catch (e) {
		console.log("[COSE] avatar base64 conversion failed:", e.message);
	}
	return avatarUrl;
}
async function checkLoginByCookie(platformId, config) {
	try {
		const cookieMap = {};
		if (config.cookieNames) for (const name of config.cookieNames) {
			const cookie = await chrome.cookies.get({
				url: config.cookieUrl || `https://${config.cookieDomain}`,
				name
			});
			if (cookie) cookieMap[name] = cookie.value;
		}
		console.log(`[COSE] ${platformId} 找到的cookies:`, Object.keys(cookieMap));
		if (!(config.cookieNames && config.cookieNames.some((name) => cookieMap[name]))) {
			console.log(`[COSE] ${platformId} 未找到登录 cookie`);
			return { loggedIn: false };
		}
		if (config.customCheck && config.checkCookieValue) {
			console.log(`[COSE] ${platformId} 使用自定义 cookie 检测`);
			const result = config.checkCookieValue(cookieMap);
			console.log(`[COSE] ${platformId} 自定义检测结果:`, result);
			return result;
		}
		let username = "";
		let avatar = "";
		if (config.getUsernameFromCookie && config.usernameCookie) username = decodeURIComponent(cookieMap[config.usernameCookie] || "");
		if (config.fetchAvatar && typeof config.fetchAvatar === "function") try {
			const fetchedAvatar = await config.fetchAvatar(cookieMap);
			if (fetchedAvatar) {
				avatar = fetchedAvatar;
				console.log(`[COSE] ${platformId} 找到头像:`, avatar);
			}
		} catch (e) {
			console.log(`[COSE] ${platformId} 获取头像失败:`, e.message);
		}
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		console.log(`[COSE] ${platformId} Cookie 检测失败:`, e.message);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
async function detectByApi(platformId, config) {
	try {
		console.log(`[COSE] ${platformId} 开始 API 检测: ${config.api}`);
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 8e3);
		let cookieStr = "";
		try {
			const domain = new URL(config.api).hostname.split(".").slice(-2).join(".");
			const domainCookies = await chrome.cookies.getAll({ domain: `.${domain}` });
			const urlCookies = await chrome.cookies.getAll({ url: config.api });
			const allCookies = [...domainCookies, ...urlCookies];
			const seen = /* @__PURE__ */ new Set();
			cookieStr = allCookies.filter((c) => {
				const key = `${c.name}=${c.value}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			}).map((c) => `${c.name}=${c.value}`).join("; ");
		} catch (e) {
			console.log(`[COSE] ${platformId} cookie 收集失败:`, e.message);
		}
		const origin = new URL(config.api).origin;
		const fetchOptions = {
			method: config.method || "GET",
			headers: {
				Accept: config.isHtml ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" : "application/json",
				"Cache-Control": "no-cache",
				...cookieStr ? { Cookie: cookieStr } : {},
				Origin: origin,
				Referer: origin + "/",
				...config.headers || {}
			},
			signal: controller.signal
		};
		if (config.body) fetchOptions.body = config.body;
		const response = await fetch(config.api, fetchOptions);
		clearTimeout(timeoutId);
		console.log(`[COSE] ${platformId} API 响应状态: ${response.status}`);
		let data = null;
		if (config.isHtml) try {
			data = await response.text();
		} catch (e) {
			data = "";
		}
		else try {
			data = await response.json();
		} catch (e) {
			data = null;
		}
		const loggedIn = config.checkLogin(data);
		if (loggedIn && config.getUserInfo) {
			const userInfo = config.getUserInfo(data);
			console.log(`[COSE] ${platformId} 用户信息:`, userInfo);
			return {
				loggedIn: true,
				...userInfo
			};
		}
		return { loggedIn: !!loggedIn };
	} catch (error) {
		console.log(`[COSE] ${platformId} API 检测失败: ${error.message}`);
		return {
			loggedIn: false,
			error: error.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/csdn.js
/**
* CSDN platform detection logic
* Strategy:
* 1. Check 'UserName' cookie (reliable indicator of login)
* 2. Use 'UserNick' cookie for display name (UserName is the user ID, UserNick is the display name)
* 3. If logged in, fetch public blog page to get avatar
*/
async function detectCSDNUser() {
	try {
		console.log("[COSE] CSDN Detection: Starting cookie check");
		const userNameCookie = await chrome.cookies.get({
			url: "https://www.csdn.net",
			name: "UserName"
		});
		if (userNameCookie && userNameCookie.value) {
			const userId = userNameCookie.value;
			console.log(`[COSE] CSDN UserName cookie found: ${userId}`);
			const userNickCookie = await chrome.cookies.get({
				url: "https://www.csdn.net",
				name: "UserNick"
			});
			const username = userNickCookie && userNickCookie.value ? decodeURIComponent(userNickCookie.value) : userId;
			console.log(`[COSE] CSDN display name: ${username}`);
			let avatar = "";
			try {
				const blogUrl = `https://blog.csdn.net/${userId}`;
				const blogHtml = await (await fetch(blogUrl, { method: "GET" })).text();
				const avatarMatch = blogHtml.match(/<img[^>]*src=["'](https:\/\/(?:profile|i-avatar)\.csdnimg\.cn\/[^"']+)["']/i) || blogHtml.match(/<img[^>]*class=["']avatar[^"']*["'][^>]*src=["']([^"']+)["']/i);
				if (avatarMatch) avatar = avatarMatch[1];
			} catch (e) {
				console.warn("[COSE] CSDN Avatar fetch failed:", e);
			}
			if (avatar && avatar.includes("csdnimg.cn")) avatar = await convertAvatarToBase64(avatar, "https://blog.csdn.net/");
			return {
				loggedIn: true,
				username,
				avatar
			};
		}
		console.log("[COSE] CSDN: No login detected");
		return { loggedIn: false };
	} catch (e) {
		console.error("[COSE] CSDN Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/oschina.js
/**
* OSChina platform detection logic
* Strategy:
* 1. Check oscid cookie existence as login indicator (MV3 service worker compatible)
* 2. Best-effort: fetch user info via API for username and avatar
*/
async function detectOSChinaUser() {
	try {
		const oscidCookie = await chrome.cookies.get({
			url: "https://www.oschina.net",
			name: "oscid"
		});
		if (!oscidCookie || !oscidCookie.value) return { loggedIn: false };
		const cookies = await chrome.cookies.getAll({ domain: ".oschina.net" });
		const wwwCookies = await chrome.cookies.getAll({ url: "https://www.oschina.net" });
		const apiCookies = await chrome.cookies.getAll({ url: "https://apiv1.oschina.net" });
		const allCookies = [
			...cookies,
			...wwwCookies,
			...apiCookies
		];
		const seen = /* @__PURE__ */ new Set();
		const cookieStr = allCookies.filter((c) => {
			const key = `${c.name}=${c.value}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}).map((c) => `${c.name}=${c.value}`).join("; ");
		let username = "";
		let avatar = "";
		let userId = "";
		try {
			const response = await fetch("https://apiv1.oschina.net/oschinapi/user/myDetails", {
				method: "GET",
				headers: {
					Accept: "application/json",
					Cookie: cookieStr
				}
			});
			if (response.ok) {
				const data = await response.json();
				if (data?.success && data?.result?.userVo) {
					username = data.result.userVo.name || "";
					avatar = data.result.userVo.portraitUrl || "";
					userId = String(data.result.userVo.id || "");
				}
			}
		} catch (e) {
			console.log("[COSE] OSChina: API fetch failed, using cookie-only detection");
		}
		if (avatar && (avatar.includes("oschina.net") || avatar.includes("oscimg"))) avatar = await convertAvatarToBase64(avatar, "https://www.oschina.net/");
		if (userId) try {
			await chrome.storage.local.set({ oschina_userId: userId });
		} catch (e) {}
		return {
			loggedIn: true,
			username,
			avatar,
			userId
		};
	} catch (e) {
		console.error("[COSE] OSChina Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/alipay.js
/**
* Alipay Open platform detection logic
* Strategy:
* 1. Check chrome.storage.local cache (1 hour TTL)
* 2. If cache miss, inject script into open Alipay tab to call API
*/
async function detectAlipayUser() {
	try {
		const cachedUser = (await chrome.storage.local.get("alipayopen_user")).alipayopen_user;
		if (cachedUser && cachedUser.loggedIn) {
			if (Date.now() - (cachedUser.cachedAt || 0) < 36e5) {
				console.log(`[COSE] alipayopen 从缓存读取用户信息:`, cachedUser.username);
				return {
					loggedIn: true,
					username: cachedUser.username || "",
					avatar: cachedUser.avatar || ""
				};
			} else {
				console.log(`[COSE] alipayopen 缓存已过期`);
				await chrome.storage.local.remove("alipayopen_user");
			}
		}
		let tabs = await chrome.tabs.query({ url: "https://open.alipay.com/*" });
		if (tabs.length === 0) tabs = await chrome.tabs.query({ url: "https://*.alipay.com/*" });
		if (tabs.length > 0) try {
			const data = (await chrome.scripting.executeScript({
				target: { tabId: tabs[0].id },
				func: async () => {
					try {
						const response = await fetch("https://developerportal.alipay.com/octopus/service.do", {
							method: "POST",
							credentials: "include",
							headers: {
								Accept: "application/json",
								"Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
							},
							body: "data=%5B%7B%7D%5D&serviceName=alipay.open.developerops.forum.user.query"
						});
						if (!response.ok) return null;
						return await response.json();
					} catch (e) {
						return null;
					}
				}
			}))?.[0]?.result;
			console.log(`[COSE] alipayopen API 数据:`, data);
			if (data?.stat === "ok" && data?.data?.isLoginUser === 1) {
				const username = data.data.nickname || "";
				const avatar = data.data.avatar || "";
				await chrome.storage.local.set({ alipayopen_user: {
					loggedIn: true,
					username,
					avatar,
					cachedAt: Date.now()
				} });
				console.log(`[COSE] alipayopen 用户信息:`, username, avatar ? "有头像" : "无头像");
				return {
					loggedIn: true,
					username,
					avatar
				};
			}
		} catch (e) {
			console.log(`[COSE] alipayopen 从页面获取用户信息失败:`, e.message);
		}
		console.log(`[COSE] alipayopen 未检测到登录状态`);
		return { loggedIn: false };
	} catch (e) {
		console.log(`[COSE] alipayopen 检测失败:`, e.message);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/weibo.js
/**
* Weibo platform detection logic
* Strategy:
* 1. Check SUBP/ALF cookies on card.weibo.com
* 2. Fetch editor page HTML and extract nick/avatar via regex
*/
async function detectWeiboUser() {
	try {
		const subpCookie = await chrome.cookies.get({
			url: "https://card.weibo.com",
			name: "SUBP"
		});
		const alfCookie = await chrome.cookies.get({
			url: "https://card.weibo.com",
			name: "ALF"
		});
		if (!subpCookie && !alfCookie) {
			console.log(`[COSE] weibo 未找到登录 cookie，未登录`);
			return { loggedIn: false };
		}
		let username = "";
		let avatar = "";
		try {
			const weiboCookies = await chrome.cookies.getAll({ domain: ".weibo.com" });
			const cardCookies = await chrome.cookies.getAll({ domain: "card.weibo.com" });
			const sinaCookies = await chrome.cookies.getAll({ domain: ".sina.com.cn" });
			const cookieString = [
				...weiboCookies,
				...cardCookies,
				...sinaCookies
			].map((c) => `${c.name}=${c.value}`).join("; ");
			const html = await (await fetch("https://card.weibo.com/article/v5/editor", {
				method: "GET",
				headers: { Cookie: cookieString },
				credentials: "include"
			})).text();
			const nickMatch = html.match(/"nick"\s*:\s*"((?:[^"\\]|\\.)*)"/);
			if (nickMatch) username = nickMatch[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
			else {
				const altNickMatch = html.match(/\\"nick\\"\s*:\s*\\"([^\\"]+)\\"/);
				if (altNickMatch) username = altNickMatch[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
			}
			const avatarMatch = html.match(/"avatar_large"\s*:\s*"([^"]+)"/);
			if (avatarMatch) avatar = avatarMatch[1].replace(/\\/g, "");
			else {
				const altAvatarMatch = html.match(/\\"avatar_large\\"\s*:\s*\\"([^\\"]+)\\"/);
				if (altAvatarMatch) {
					let rawAvatar = altAvatarMatch[1].replace(/\\\\\\\//g, "/");
					if (rawAvatar.includes("sinaimg.cn")) avatar = rawAvatar.split("?")[0];
					else avatar = rawAvatar;
				}
			}
			console.log(`[COSE] weibo 用户信息: ${username}`);
		} catch (e) {
			console.log(`[COSE] weibo 获取用户详情失败:`, e.message);
		}
		if (!username) return { loggedIn: false };
		if (avatar && avatar.includes("sinaimg.cn")) avatar = await convertAvatarToBase64(avatar, "https://weibo.com/");
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		console.log(`[COSE] weibo 检测失败:`, e.message);
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/wechat.js
/**
* WeChat Official Account platform detection logic
* Strategy:
* 1. Check chrome.storage.local cache (1 hour TTL)
* 2. Inject script into open mp.weixin.qq.com tab to read wx.data
* 3. Fallback: fetch mp.weixin.qq.com HTML and parse nick_name/head_img
*/
async function detectWechatUser() {
	try {
		const cachedUser = (await chrome.storage.local.get("wechat_user")).wechat_user;
		if (cachedUser && cachedUser.loggedIn) {
			if (Date.now() - (cachedUser.cachedAt || 0) < 36e5) {
				console.log(`[COSE] wechat 从缓存读取:`, cachedUser.username);
				return {
					loggedIn: true,
					username: cachedUser.username || "",
					avatar: cachedUser.avatar || ""
				};
			} else await chrome.storage.local.remove("wechat_user");
		}
		const tabs = await chrome.tabs.query({ url: "https://mp.weixin.qq.com/*" });
		if (tabs.length > 0) try {
			const result = (await chrome.scripting.executeScript({
				target: { tabId: tabs[0].id },
				func: () => {
					const wxData = window.wx?.data;
					if (wxData && wxData.nick_name) return {
						loggedIn: true,
						username: wxData.nick_name || wxData.user_name || "",
						avatar: wxData.head_img || "",
						token: wxData.t || ""
					};
					return null;
				}
			}))?.[0]?.result;
			if (result && result.loggedIn) {
				const userInfo = {
					...result,
					cachedAt: Date.now()
				};
				await chrome.storage.local.set({ wechat_user: userInfo });
				return {
					loggedIn: true,
					username: userInfo.username || "",
					avatar: userInfo.avatar || ""
				};
			}
		} catch (e) {
			console.log(`[COSE] wechat 页面脚本执行失败:`, e.message);
		}
		try {
			const html = await (await fetch("https://mp.weixin.qq.com/", {
				method: "GET",
				credentials: "include",
				headers: { Accept: "text/html" }
			})).text();
			if (html.includes("请使用微信扫描") || html.includes("扫码登录")) return { loggedIn: false };
			const nickMatch = html.match(/nick_name\s*[:=]\s*["']([^"']+)["']/);
			const avatarMatch = html.match(/head_img\s*[:=]\s*["']([^"']+)["']/);
			if (nickMatch) {
				const username = nickMatch[1];
				const avatar = avatarMatch ? avatarMatch[1] : "";
				await chrome.storage.local.set({ wechat_user: {
					loggedIn: true,
					username,
					avatar,
					cachedAt: Date.now()
				} });
				return {
					loggedIn: true,
					username,
					avatar
				};
			}
		} catch (e) {
			console.log(`[COSE] wechat fetch 失败:`, e.message);
		}
		return { loggedIn: false };
	} catch (e) {
		console.log(`[COSE] wechat 检测失败:`, e.message);
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/xiaohongshu.js
/**
* Xiaohongshu (Little Red Book) platform detection logic
* Strategy:
* 1. Check `a1` cookie on creator.xiaohongshu.com as login indicator
* 2. Best-effort: fetch user info via offscreen document or open tab
* 3. Fall back to chrome.storage.local cache for user details
*/
async function detectXiaohongshuUser() {
	try {
		const a1Cookie = await chrome.cookies.get({
			url: "https://creator.xiaohongshu.com",
			name: "a1"
		});
		if (!a1Cookie || !a1Cookie.value) return { loggedIn: false };
		try {
			const offscreenDetect = globalThis.__coseDetectXiaohongshu;
			if (offscreenDetect) {
				const offResult = await offscreenDetect();
				if (offResult && offResult.loggedIn) {
					const userInfo = {
						...offResult,
						cachedAt: Date.now()
					};
					await chrome.storage.local.set({ xiaohongshu_user: userInfo });
					return {
						loggedIn: true,
						username: offResult.username || "",
						avatar: offResult.avatar || ""
					};
				}
			}
		} catch (e) {
			console.log("[COSE] xiaohongshu offscreen detection failed:", e.message);
		}
		try {
			const tabs = await chrome.tabs.query({ url: "https://creator.xiaohongshu.com/*" });
			if (tabs.length > 0) {
				const result = (await chrome.scripting.executeScript({
					target: { tabId: tabs[0].id },
					func: async () => {
						try {
							const response = await fetch("https://creator.xiaohongshu.com/api/galaxy/user/info", {
								method: "GET",
								credentials: "include",
								headers: { Accept: "application/json" }
							});
							if (!response.ok) return null;
							const data = await response.json();
							if (data?.success === true && data?.code === 0 && data?.data?.userId) return {
								loggedIn: true,
								username: data.data.userName || data.data.redId || "",
								avatar: data.data.userAvatar || "",
								userId: data.data.userId
							};
							return null;
						} catch (e) {
							return null;
						}
					}
				}))?.[0]?.result;
				if (result && result.loggedIn) {
					const userInfo = {
						...result,
						cachedAt: Date.now()
					};
					await chrome.storage.local.set({ xiaohongshu_user: userInfo });
					return {
						loggedIn: true,
						username: userInfo.username || "",
						avatar: userInfo.avatar || ""
					};
				}
			}
		} catch (e) {
			console.log("[COSE] xiaohongshu tab detection failed:", e.message);
		}
		const cachedUser = (await chrome.storage.local.get("xiaohongshu_user")).xiaohongshu_user;
		if (cachedUser && cachedUser.username) {
			if (Date.now() - (cachedUser.cachedAt || 0) < 6048e5) {
				console.log("[COSE] xiaohongshu 从缓存读取:", cachedUser.username);
				return {
					loggedIn: true,
					username: cachedUser.username || "",
					avatar: cachedUser.avatar || ""
				};
			}
		}
		return {
			loggedIn: true,
			username: "",
			avatar: ""
		};
	} catch (e) {
		console.log("[COSE] xiaohongshu 检测失败:", e.message);
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/elecfans.js
/**
* Elecfans (电子发烧友) detection logic
* API: /api/mobile/index.php?module=profile (Discuz standard mobile API)
* Response: { Variables: { member_uid, space: { username, realname }, member_avatar } }
* Uses chrome.cookies.getAll to attach cookies manually (SameSite workaround)
*/
async function detectElecfansUser() {
	try {
		const cookies = await chrome.cookies.getAll({ domain: ".elecfans.com" });
		const bbsCookies = await chrome.cookies.getAll({ url: "https://bbs.elecfans.com" });
		const allCookies = [...cookies, ...bbsCookies];
		const seen = /* @__PURE__ */ new Set();
		const cookieStr = allCookies.filter((c) => {
			const key = `${c.name}=${c.value}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}).map((c) => `${c.name}=${c.value}`).join("; ");
		if (!cookieStr) return { loggedIn: false };
		const response = await fetch("https://bbs.elecfans.com/api/mobile/index.php?module=profile", {
			method: "GET",
			headers: {
				Accept: "application/json",
				Cookie: cookieStr
			}
		});
		if (!response.ok) return { loggedIn: false };
		const data = await response.json();
		if (!data?.Variables?.member_uid) return { loggedIn: false };
		const username = data.Variables.space?.username || data.Variables.space?.realname || data.Variables.member_username || "";
		let avatar = data.Variables.member_avatar || "";
		if (!username) return { loggedIn: false };
		if (avatar) avatar = await convertAvatarToBase64(avatar, "https://bbs.elecfans.com/");
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/huaweicloud.js
var HUAWEICLOUD_API = "https://devdata.huaweicloud.com/rest/developer/fwdu/rest/developer/user/hdcommunityservice/v1/member/get-personal-info";
/**
* Huawei Cloud platform detection logic
* 直接通过 API + 手动附加 cookie 检测，无需打开华为云页面
*/
async function detectHuaweiCloudUser() {
	try {
		const result = await detectByApi("huaweicloud", {
			api: HUAWEICLOUD_API,
			method: "GET",
			checkLogin: (data) => data && data.memName,
			getUserInfo: (data) => ({
				username: data.memAlias || data.memName || "",
				avatar: data.memPhoto || ""
			})
		});
		if (result.loggedIn) {
			let avatar = result.avatar || "";
			if (avatar && avatar.startsWith("http")) avatar = await convertAvatarToBase64(avatar, "https://bbs.huaweicloud.com/");
			await chrome.storage.local.set({ huaweicloud_user: {
				loggedIn: true,
				username: result.username,
				avatar,
				cachedAt: Date.now()
			} });
			return {
				loggedIn: true,
				username: result.username,
				avatar
			};
		}
		await chrome.storage.local.remove("huaweicloud_user");
		return { loggedIn: false };
	} catch (e) {
		console.error("[COSE] HuaweiCloud Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/huaweidev.js
/**
* Huawei Developer platform detection logic
* Strategy (cache detection pattern):
* 1. Check chrome.storage.local cache (7 days TTL) + cookie validation
* 2. Try executeScript on open developer.huawei.com tab to call API with credentials
* 3. Content script auto-caches user info when visiting huawei developer pages
* 4. Fallback: check developer_userdata cookie existence for basic login status
*/
async function detectHuaweiDevUser() {
	try {
		const cachedUser = (await chrome.storage.local.get("huaweidev_user")).huaweidev_user;
		if (cachedUser && cachedUser.loggedIn) {
			if (Date.now() - (cachedUser.cachedAt || 0) < 6048e5 && cachedUser.username) {
				const userCookie = await chrome.cookies.get({
					url: "https://developer.huawei.com",
					name: "developer_userdata"
				});
				if (userCookie && userCookie.value) {
					console.log("[COSE] HuaweiDev: using cached user info:", cachedUser.username);
					let avatar = cachedUser.avatar || "";
					if (avatar && avatar.startsWith("http")) {
						avatar = await convertAvatarToBase64(avatar, "https://developer.huawei.com/");
						await chrome.storage.local.set({ huaweidev_user: {
							...cachedUser,
							avatar
						} });
					}
					return {
						loggedIn: true,
						username: cachedUser.username,
						avatar
					};
				}
				console.log("[COSE] HuaweiDev: cache exists but cookie gone, clearing cache");
				await chrome.storage.local.remove("huaweidev_user");
			} else await chrome.storage.local.remove("huaweidev_user");
		}
		const tabs = await chrome.tabs.query({ url: "https://developer.huawei.com/*" });
		if (tabs.length > 0) try {
			const result = (await chrome.scripting.executeScript({
				target: { tabId: tabs[0].id },
				func: async () => {
					try {
						const userNameEl = document.querySelector(".user_name");
						const domUsername = userNameEl ? userNameEl.textContent.trim() : "";
						const udCookie = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("developer_userdata="));
						if (!udCookie) return domUsername ? {
							loggedIn: true,
							username: domUsername,
							avatar: ""
						} : null;
						const udValue = decodeURIComponent(udCookie.split("=").slice(1).join("="));
						let csrfToken = "";
						try {
							const udJson = JSON.parse(udValue);
							csrfToken = udJson.csrf || udJson.csrftoken || "";
						} catch (e) {
							return domUsername ? {
								loggedIn: true,
								username: domUsername,
								avatar: ""
							} : null;
						}
						if (!csrfToken) return domUsername ? {
							loggedIn: true,
							username: domUsername,
							avatar: ""
						} : null;
						const hdDate = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
						let avatar = "";
						try {
							const resp = await fetch("https://svc-drcn.developer.huawei.com/codeserver/Common/v1/delegate", {
								method: "POST",
								credentials: "include",
								headers: {
									"Content-Type": "application/json",
									Accept: "application/json",
									"x-hd-csrf": csrfToken,
									"x-hd-date": hdDate
								},
								body: JSON.stringify({
									svc: "GOpen.User.getInfo",
									reqType: 0,
									reqJson: JSON.stringify({ queryRangeFlag: "00000000000001" })
								})
							});
							if (resp.ok) {
								const data = await resp.json();
								if (data && data.returnCode === "0" && data.resJson) avatar = JSON.parse(data.resJson).headPictureURL || "";
							}
						} catch (e) {}
						return {
							loggedIn: true,
							username: domUsername || "",
							avatar
						};
					} catch (e) {
						return null;
					}
				}
			}))?.[0]?.result;
			if (result && result.loggedIn) {
				let avatar = result.avatar || "";
				if (avatar && avatar.startsWith("http")) avatar = await convertAvatarToBase64(avatar, "https://developer.huawei.com/");
				const userInfo = {
					...result,
					avatar,
					cachedAt: Date.now()
				};
				await chrome.storage.local.set({ huaweidev_user: userInfo });
				return {
					loggedIn: true,
					username: userInfo.username,
					avatar
				};
			}
		} catch (e) {
			console.log("[COSE] HuaweiDev: executeScript failed:", e.message);
		}
		const userCookie = await chrome.cookies.get({
			url: "https://developer.huawei.com",
			name: "developer_userdata"
		});
		if (userCookie && userCookie.value) {
			console.log("[COSE] HuaweiDev: developer_userdata cookie found, trying offscreen fetch for user info");
			let username = "";
			let avatar = "";
			let apiSuccess = false;
			try {
				const udValue = decodeURIComponent(userCookie.value);
				const udJson = JSON.parse(udValue);
				const csrfToken = udJson.csrftoken || udJson.csrf || "";
				if (csrfToken) {
					const hdDate = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
					try {
						await chrome.offscreen.createDocument({
							url: "offscreen.html",
							reasons: ["DOM_SCRAPING"],
							justification: "Fetch Huawei Developer user info with cookies"
						});
					} catch (e) {
						if (!e.message.includes("Only a single offscreen")) throw e;
					}
					const response = await chrome.runtime.sendMessage({
						type: "OFFSCREEN_FETCH",
						payload: {
							url: "https://svc-drcn.developer.huawei.com/codeserver/Common/v1/delegate",
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Accept: "application/json",
								"x-hd-csrf": csrfToken,
								"x-hd-date": hdDate
							},
							body: {
								svc: "GOpen.User.getInfo",
								reqType: 0,
								reqJson: JSON.stringify({ queryRangeFlag: "00000000000001" })
							}
						}
					});
					if (response?.success && response.data) {
						const data = response.data;
						if (data.returnCode === "0" && data.resJson) {
							const userInfo = JSON.parse(data.resJson);
							username = userInfo.displayName || "";
							avatar = userInfo.headPictureURL || "";
							if (avatar && avatar.startsWith("http")) avatar = await convertAvatarToBase64(avatar, "https://developer.huawei.com/");
							apiSuccess = true;
						}
					}
					try {
						await chrome.offscreen.closeDocument();
					} catch (e) {}
				}
			} catch (e) {
				console.log("[COSE] HuaweiDev: offscreen fetch failed:", e.message);
			}
			if (apiSuccess) {
				if (username) {
					const userInfo = {
						loggedIn: true,
						username,
						avatar,
						cachedAt: Date.now()
					};
					await chrome.storage.local.set({ huaweidev_user: userInfo });
				}
				return {
					loggedIn: true,
					username,
					avatar
				};
			} else {
				await chrome.storage.local.remove("huaweidev_user");
				console.log("[COSE] HuaweiDev: API verification failed, treating as logged out");
				return { loggedIn: false };
			}
		}
		return { loggedIn: false };
	} catch (e) {
		console.error("[COSE] HuaweiDev Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/sspai.js
/**
* Sspai (少数派) platform detection logic
* Strategy:
* 1. Check sspai_jwt_token cookie
* 2. Call user info API with Bearer token
*/
async function detectSspaiUser() {
	try {
		const jwtCookie = await chrome.cookies.get({
			url: "https://sspai.com",
			name: "sspai_jwt_token"
		});
		if (!jwtCookie || !jwtCookie.value) return { loggedIn: false };
		const token = jwtCookie.value;
		const data = await (await fetch("https://sspai.com/api/v1/user/info/get", {
			method: "GET",
			credentials: "include",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${token}`
			}
		})).json();
		if (data.error === 0 && data.data?.nickname) return {
			loggedIn: true,
			username: data.data.nickname,
			avatar: data.data.avatar || ""
		};
		else return { loggedIn: false };
	} catch (e) {
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/aliyun.js
/**
* Aliyun Developer platform detection logic
* Strategy:
* 1. Check login_aliyunid_ticket cookie
* 2. Call getUser API for username/avatar
* 3. Convert avatar to base64 to bypass CORS/ORB
*/
async function detectAliyunUser() {
	try {
		const ticketCookie = await chrome.cookies.get({
			url: "https://developer.aliyun.com",
			name: "login_aliyunid_ticket"
		});
		if (!ticketCookie || !ticketCookie.value) return { loggedIn: false };
		const data = await (await fetch("https://developer.aliyun.com/developer/api/my/user/getUser", {
			method: "GET",
			credentials: "include",
			headers: { Accept: "application/json" }
		})).json();
		if (data.success && data.data?.nickname) {
			let avatar = data.data.avatar || "";
			if (avatar) avatar = await convertAvatarToBase64(avatar, "https://developer.aliyun.com/");
			return {
				loggedIn: true,
				username: data.data.nickname,
				avatar
			};
		}
		return { loggedIn: false };
	} catch (e) {
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/sohu.js
/**
* Sohu (搜狐号) platform detection logic
* Strategy:
* 1. Check ppinf cookie on mp.sohu.com
* 2. Call account list API for nickname/avatar
*/
async function detectSohuUser() {
	try {
		const ppinfCookie = await chrome.cookies.get({
			url: "https://mp.sohu.com",
			name: "ppinf"
		});
		if (!ppinfCookie || !ppinfCookie.value) return { loggedIn: false };
		try {
			const data = await (await fetch("https://mp.sohu.com/mpbp/bp/account/list", {
				method: "GET",
				credentials: "include",
				headers: { Accept: "application/json" }
			})).json();
			if (data.success && data.data?.data?.[0]?.accounts?.[0]) {
				const account = data.data.data[0].accounts[0];
				let avatar = account.avatar || "";
				if (avatar.startsWith("//")) avatar = "https:" + avatar;
				return {
					loggedIn: true,
					username: account.nickName,
					avatar
				};
			} else return {
				loggedIn: true,
				username: "",
				avatar: ""
			};
		} catch (e) {
			return {
				loggedIn: true,
				username: "",
				avatar: ""
			};
		}
	} catch (e) {
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/medium.js
/**
* Medium platform detection logic
* Strategy:
* 1. Check sid/uid cookies
* 2. Fetch stats page and extract username/avatar via regex
*/
async function detectMediumUser() {
	try {
		const sidCookie = await chrome.cookies.get({
			url: "https://medium.com",
			name: "sid"
		});
		const uidCookie = await chrome.cookies.get({
			url: "https://medium.com",
			name: "uid"
		});
		if (!sidCookie && !uidCookie) return { loggedIn: false };
		const response = await fetch("https://medium.com/me/stats", {
			method: "GET",
			credentials: "include"
		});
		const html = await response.text();
		const finalUrl = response.url;
		if (finalUrl.includes("/m/signin") || finalUrl.includes("?signIn")) return { loggedIn: false };
		const profileMatch = html.match(/"username"\s*:\s*"([^"]+)"/) || html.match(/href="https:\/\/medium\.com\/@([^"?\/]+)"/) || html.match(/medium\.com\/@([a-zA-Z0-9_]+)/);
		if (profileMatch && profileMatch[1] && profileMatch[1] !== "gmail" && profileMatch[1] !== "medium") {
			const username = profileMatch[1];
			let avatar = "";
			const imageIdMatch = html.match(new RegExp(`"imageId"\\s*:\\s*"([^"]+)"[^}]*"username"\\s*:\\s*"${username}"`)) || html.match(new RegExp(`"username"\\s*:\\s*"${username}"[^}]*"imageId"\\s*:\\s*"([^"]+)"`));
			if (imageIdMatch) avatar = `https://miro.medium.com/v2/resize:fill:64:64/${imageIdMatch[1]}`;
			return {
				loggedIn: true,
				username,
				avatar
			};
		} else return {
			loggedIn: true,
			username: "",
			avatar: ""
		};
	} catch (e) {
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/tencentcloud.js
/**
* Tencent Cloud platform detection logic
* Strategy:
* 1. Fetch creator page
* 2. Check redirect and parse HTML for nickname/avatar
*/
async function detectTencentCloudUser() {
	try {
		const response = await fetch("https://cloud.tencent.com/developer/creator", {
			method: "GET",
			credentials: "include"
		});
		const html = await response.text();
		if (!response.url.includes("/creator")) return { loggedIn: false };
		if (html.includes("登录/注册") || html.includes("\"isLogin\":false") || html.includes("\"login\":false")) return { loggedIn: false };
		const userInfoMatch = html.match(/"userInfo"\s*:\s*\{[^}]*"nickname"\s*:\s*"([^"]+)"[^}]*\}/) || html.match(/"creatorInfo"\s*:\s*\{[^}]*"nickname"\s*:\s*"([^"]+)"[^}]*\}/) || html.match(/"currentUser"\s*:\s*\{[^}]*"nickname"\s*:\s*"([^"]+)"[^}]*\}/);
		const creatorNicknameMatch = html.match(/class="creator-info[^"]*"[^>]*>[\s\S]*?<[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)</) || html.match(/"isCreator"\s*:\s*true[\s\S]*?"nickname"\s*:\s*"([^"]+)"/);
		const nicknameMatch = userInfoMatch || creatorNicknameMatch;
		const avatarMatch = html.match(/"userInfo"[\s\S]*?"avatarUrl"\s*:\s*"([^"]+)"/) || html.match(/"avatar"\s*:\s*"(https?:\/\/[^"]+)"/);
		if (nicknameMatch && nicknameMatch[1]) {
			let avatar = avatarMatch ? avatarMatch[1] : "";
			if (avatar && avatar.includes("qcloudimg.com")) avatar = await convertAvatarToBase64(avatar, "https://cloud.tencent.com/");
			return {
				loggedIn: true,
				username: nicknameMatch[1],
				avatar
			};
		} else {
			if (html.includes("创作中心") || html.includes("我的文章")) return {
				loggedIn: true,
				username: "",
				avatar: ""
			};
			return { loggedIn: false };
		}
	} catch (e) {
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/qianfan.js
/**
* Baidu Qianfan platform detection logic
* Strategy:
* 1. Read csrftoken from bce-user-info-ct-id cookie
* 2. Call current user API with csrftoken header
*/
async function detectQianfanUser() {
	try {
		console.log("[COSE] Qianfan Detection: Starting");
		const csrfCookie = await chrome.cookies.get({
			url: "https://qianfan.cloud.baidu.com",
			name: "bce-user-info-ct-id"
		});
		const csrfToken = csrfCookie?.value ? csrfCookie.value.replace(/"/g, "") : "";
		const response = await fetch("https://qianfan.cloud.baidu.com/api/community/user/current", {
			method: "GET",
			credentials: "include",
			headers: {
				Accept: "application/json",
				...csrfToken ? { csrftoken: csrfToken } : {}
			}
		});
		if (!response.ok) return { loggedIn: false };
		const data = await response.json();
		if (data.success && data.result) {
			const username = data.result.displayName || data.result.nickname || "";
			let avatar = data.result.avatar || "";
			if (avatar && avatar.includes("bdimg.com")) avatar = await convertAvatarToBase64(avatar, "https://qianfan.cloud.baidu.com/");
			return {
				loggedIn: true,
				username,
				avatar
			};
		} else return { loggedIn: false };
	} catch (e) {
		console.error("[COSE] Qianfan Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/twitter.js
/**
* Twitter/X platform detection logic
* Strategy:
* 1. Check auth_token/ct0 cookies on x.com
* 2. Fetch home page HTML and extract screen_name/avatar via regex
*/
async function detectTwitterUser() {
	try {
		const authTokenCookie = await chrome.cookies.get({
			url: "https://x.com",
			name: "auth_token"
		});
		await chrome.cookies.get({
			url: "https://x.com",
			name: "ct0"
		});
		if (!authTokenCookie) return { loggedIn: false };
		let username = "";
		let avatar = "";
		try {
			const response = await fetch("https://x.com/home", {
				method: "GET",
				credentials: "include",
				headers: { Accept: "text/html" }
			});
			if (response.ok) {
				const html = await response.text();
				const screenNameMatch = html.match(/"screen_name"\s*:\s*"([^"]+)"/);
				if (screenNameMatch) username = screenNameMatch[1];
				const avatarMatch = html.match(/"profile_image_url_https"\s*:\s*"([^"]+)"/);
				if (avatarMatch) avatar = avatarMatch[1].replace("_normal.", "_x96.");
			}
		} catch (e) {}
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/bilibili.js
/**
* Bilibili platform detection logic
* Strategy:
* 1. Call https://api.bilibili.com/x/web-interface/nav API
* 2. Extract username (uname) and avatar (face)
* 3. Convert hdslb.com avatar to base64 data URL to bypass CORS/ORB
*/
async function detectBilibiliUser() {
	try {
		const data = await (await fetch("https://api.bilibili.com/x/web-interface/nav", {
			method: "GET",
			credentials: "include",
			headers: {
				Accept: "application/json",
				"Cache-Control": "no-cache"
			}
		})).json();
		if (data?.code !== 0 || !data?.data?.isLogin) return { loggedIn: false };
		const username = data.data.uname || "";
		let avatar = data.data.face || "";
		if (avatar && avatar.includes("hdslb.com")) avatar = await convertAvatarToBase64(avatar, "https://www.bilibili.com/");
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		console.log(`[COSE] bilibili 检测失败:`, e.message);
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/cto51.js
/**
* 51CTO platform detection logic (same approach as 爱贝壳)
* Fetch https://home.51cto.com/space via offscreen document,
* parse HTML with DOMParser to extract avatar, uid, nickname.
*/
async function detectCTO51User() {
	try {
		console.log("[COSE] 51CTO Detection: Starting (offscreen)");
		if (typeof globalThis.__coseDetectCto51 === "function") {
			const result = await globalThis.__coseDetectCto51();
			if (result && result.loggedIn) {
				let avatar = result.avatar || "";
				if (avatar && avatar.startsWith("http") && avatar.includes("51cto.com")) avatar = await convertAvatarToBase64(avatar, "https://home.51cto.com/");
				console.log("[COSE] 51CTO: Logged in:", result.username);
				return {
					loggedIn: true,
					username: result.username || "",
					avatar
				};
			}
			if (result && result._debug) {
				console.log("[COSE] 51CTO: Not logged in, debug:", JSON.stringify(result._debug));
				return {
					loggedIn: false,
					_debug: result._debug
				};
			}
		}
		console.log("[COSE] 51CTO: Not logged in");
		return { loggedIn: false };
	} catch (e) {
		console.error("[COSE] 51CTO Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/jianshu.js
/**
* Jianshu platform detection logic
* Strategy: Fetch settings JSON API to get nickname and avatar
*/
async function detectJianshuUser() {
	try {
		console.log("[COSE] Jianshu Detection: Starting");
		const response = await fetch("https://www.jianshu.com/settings/basic.json", {
			method: "GET",
			credentials: "include",
			headers: { Accept: "application/json" }
		});
		if (!response.ok) return { loggedIn: false };
		const json = await response.json();
		if (!json?.data) return { loggedIn: false };
		const username = json.data.nickname || "";
		let avatar = json.data.avatar || "";
		if (avatar && avatar.includes("jianshu.io")) avatar = await convertAvatarToBase64(avatar, "https://www.jianshu.com/");
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		console.error("[COSE] Jianshu Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/segmentfault.js
/**
* SegmentFault platform detection logic
* Strategy: Fetch homepage HTML and extract user info from __NEXT_DATA__ JSON
* The /gateway/user/me API requires CSRF tokens (ivd param), so we use HTML scraping instead.
*/
async function detectSegmentFaultUser() {
	try {
		console.log("[COSE] SegmentFault Detection: Starting");
		const nextDataMatch = (await (await fetch("https://segmentfault.com/", {
			method: "GET",
			credentials: "include",
			headers: { Accept: "text/html" }
		})).text()).match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
		if (!nextDataMatch) {
			console.log("[COSE] SegmentFault: No __NEXT_DATA__ found");
			return { loggedIn: false };
		}
		const nextData = JSON.parse(nextDataMatch[1]);
		const sessionUser = nextData?.props?.pageProps?.initialState?.global?.sessionUser;
		const sessionInfo = nextData?.props?.pageProps?.initialState?.global?.sessionInfo;
		if (!sessionUser?.user?.id && !sessionInfo?.login) {
			console.log("[COSE] SegmentFault: Not logged in");
			return { loggedIn: false };
		}
		const user = sessionUser?.user || {};
		const username = user.name || user.slug || "";
		let avatar = user.avatar_url || "";
		if (avatar && avatar.includes("segmentfault.com")) avatar = await convertAvatarToBase64(avatar, "https://segmentfault.com/");
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		console.error("[COSE] SegmentFault Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/infoq.js
/**
* InfoQ platform detection logic
* Strategy: POST to /public/v1/user/get_user API to get user info
* The old /public/v1/my/menu endpoint returns 404.
*/
async function detectInfoQUser() {
	try {
		console.log("[COSE] InfoQ Detection: Starting");
		const response = await fetch("https://www.infoq.cn/public/v1/user/get_user", {
			method: "POST",
			credentials: "include",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json"
			},
			body: JSON.stringify({})
		});
		if (!response.ok) return { loggedIn: false };
		const json = await response.json();
		if (json?.code !== 0 || !json?.data?.uid) {
			console.log("[COSE] InfoQ: Not logged in", json?.code);
			return { loggedIn: false };
		}
		const username = json.data.nickname || "";
		let avatar = json.data.avatar || "";
		if (avatar && avatar.includes("geekbang.org")) avatar = await convertAvatarToBase64(avatar, "https://www.infoq.cn/");
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		console.error("[COSE] InfoQ Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/modelscope.js
/**
* ModelScope platform detection logic
* Strategy:
* 1. Try /api/v1/users/login/info API (correct endpoint found via network inspection)
* 2. Fallback: find an open ModelScope tab and extract username/avatar from DOM
* 3. Fallback: check for auth cookies on modelscope.cn
* 4. Convert avatar to base64 to bypass CORS/ORB
*/
async function detectModelScopeUser() {
	try {
		let username = "";
		let avatar = "";
		try {
			const response = await fetch("https://modelscope.cn/api/v1/users/login/info", {
				method: "GET",
				credentials: "include",
				headers: { Accept: "application/json" }
			});
			if (response.ok) {
				const data = await response.json();
				if (data?.Success !== false && data?.Code !== 10019901001) {
					const user = data?.Data?.User || data?.Data || {};
					username = user.Nickname || user.NickName || user.Name || user.nickname || user.name || user.Login || user.login || "";
					avatar = user.Avatar || user.avatar || "";
				}
			}
		} catch (e) {}
		if (username) {
			if (avatar) avatar = await convertAvatarToBase64(avatar, "https://modelscope.cn/");
			return {
				loggedIn: true,
				username,
				avatar
			};
		}
		try {
			const tabs = await chrome.tabs.query({ url: "https://modelscope.cn/*" });
			if (tabs.length > 0) {
				const results = await chrome.scripting.executeScript({
					target: { tabId: tabs[0].id },
					func: () => {
						let avatarSrc = "";
						for (const sel of [
							"img[src*=\"avatar\"]",
							".ant-avatar img",
							"img[class*=\"avatar\" i]",
							"img[class*=\"Avatar\" i]"
						]) {
							const img = document.querySelector(sel);
							if (img && img.src && !img.src.includes("data:image/svg")) {
								avatarSrc = img.src;
								break;
							}
						}
						let name = "";
						const allLinks = document.querySelectorAll("a[href*=\"/profile/\"]");
						for (const a of allLinks) {
							const match = (a.getAttribute("href") || "").match(/\/profile\/([^/?#]+)/);
							if (match && match[1]) {
								name = match[1];
								break;
							}
						}
						if (!name) {
							const myLink = document.querySelector("a[href=\"/my/overview\"]");
							if (myLink) {
								const parent = myLink.closest("[class*=\"dropdown\"]") || myLink.parentElement;
								if (parent) {
									const spans = parent.querySelectorAll("span");
									for (const s of spans) {
										const t = s.textContent.trim();
										if (t && t.length > 1 && t.length < 30 && ![
											"登录",
											"注册",
											"退出",
											"设置"
										].includes(t)) {
											name = t;
											break;
										}
									}
								}
							}
						}
						return {
							username: name,
							avatar: avatarSrc
						};
					}
				});
				if (results?.[0]?.result) {
					username = results[0].result.username || "";
					avatar = results[0].result.avatar || "";
				}
				if (username || avatar) {
					if (avatar) avatar = await convertAvatarToBase64(avatar, "https://modelscope.cn/");
					return {
						loggedIn: true,
						username,
						avatar
					};
				}
			}
		} catch (e) {}
		return { loggedIn: false };
	} catch (e) {
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/volcengine.js
/**
* Volcengine (火山引擎开发者社区) detection logic
* API: /api/fe/v1/user (found via Chrome DevTools network inspection)
* Response: { data: { name, avatar: { url } }, err_no: 0 }
* Uses chrome.cookies.getAll to attach cookies manually since service worker
* fetch with credentials:'include' doesn't reliably send SameSite cookies.
*/
async function detectVolcengineUser() {
	try {
		const cookies = await chrome.cookies.getAll({ domain: ".volcengine.com" });
		const devCookies = await chrome.cookies.getAll({ url: "https://developer.volcengine.com" });
		const allCookies = [...cookies, ...devCookies];
		const seen = /* @__PURE__ */ new Set();
		const cookieStr = allCookies.filter((c) => {
			const key = `${c.name}=${c.value}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}).map((c) => `${c.name}=${c.value}`).join("; ");
		if (!cookieStr) return { loggedIn: false };
		const response = await fetch("https://developer.volcengine.com/api/fe/v1/user", {
			method: "GET",
			headers: {
				Accept: "application/json",
				Cookie: cookieStr
			}
		});
		if (!response.ok) return { loggedIn: false };
		const data = await response.json();
		if (data?.err_no !== 0 || !data?.data?.name) return { loggedIn: false };
		let username = data.data.name;
		let avatar = data.data.avatar?.url || "";
		if (avatar) avatar = await convertAvatarToBase64(avatar, "https://developer.volcengine.com/");
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/cnblogs.js
/**
* Cnblogs (博客园) detection logic (offscreen approach)
* Fetch https://account.cnblogs.com/user/userinfo via offscreen document,
* where cookies are sent automatically in document context.
*/
async function detectCnblogsUser() {
	try {
		console.log("[COSE] Cnblogs Detection: Starting (offscreen)");
		if (typeof globalThis.__coseDetectCnblogs === "function") {
			const result = await globalThis.__coseDetectCnblogs();
			if (result && result.loggedIn) {
				let avatar = result.avatar || "";
				if (avatar && avatar.includes("cnblogs.com")) avatar = await convertAvatarToBase64(avatar, "https://www.cnblogs.com/");
				console.log("[COSE] Cnblogs: Logged in:", result.username);
				return {
					loggedIn: true,
					username: result.username || "",
					avatar
				};
			}
		}
		console.log("[COSE] Cnblogs: Not logged in");
		return { loggedIn: false };
	} catch (e) {
		console.error("[COSE] Cnblogs Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/wangyihao.js
/**
* 网易号 detection logic
* Strategy:
* 1. Collect cookies via chrome.cookies.getAll (MV3 service worker compatible)
* 2. Fetch user info via mp.163.com/wemedia/navinfo.do with cookies attached manually
* 3. Extract username and avatar from API response
*/
async function detectWangyihaoUser() {
	try {
		const cookies = await chrome.cookies.getAll({ domain: ".163.com" });
		const mpCookies = await chrome.cookies.getAll({ url: "https://mp.163.com" });
		const allCookies = [...cookies, ...mpCookies];
		const seen = /* @__PURE__ */ new Set();
		const cookieStr = allCookies.filter((c) => {
			const key = `${c.name}=${c.value}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}).map((c) => `${c.name}=${c.value}`).join("; ");
		if (!cookieStr) return { loggedIn: false };
		const response = await fetch(`https://mp.163.com/wemedia/navinfo.do?_=${Date.now()}`, {
			method: "GET",
			headers: {
				Accept: "application/json",
				Cookie: cookieStr
			}
		});
		if (!response.ok) return { loggedIn: false };
		const data = await response.json();
		if (data?.code !== 1 || !data?.data?.wemediaId) return { loggedIn: false };
		const username = data.data.tname || "";
		let avatar = data.data.icon || "";
		if (avatar && (avatar.includes("126.net") || avatar.includes("163.com"))) avatar = await convertAvatarToBase64(avatar, "https://mp.163.com/");
		return {
			loggedIn: true,
			username,
			avatar
		};
	} catch (e) {
		console.error("[COSE] Wangyihao Detection Error:", e);
		return {
			loggedIn: false,
			error: e.message
		};
	}
}
//#endregion
//#region ../../packages/detection/src/platforms/douban.js
async function convertToBase64WithFallback(avatarUrl) {
	if (!avatarUrl) return "";
	try {
		const converted = await convertAvatarToBase64(avatarUrl, "https://www.douban.com/");
		if (converted && converted.startsWith("data:")) return converted;
	} catch (e) {
		console.log("[COSE] douban 通用头像转换失败:", e.message);
	}
	try {
		const cookieHeader = (await chrome.cookies.getAll({ domain: ".douban.com" })).map((c) => `${c.name}=${c.value}`).join("; ");
		const imgResp = await fetch(avatarUrl, {
			method: "GET",
			headers: {
				Referer: "https://www.douban.com/",
				...cookieHeader ? { Cookie: cookieHeader } : {}
			},
			credentials: "include"
		});
		if (!imgResp.ok) return avatarUrl;
		const blob = await imgResp.blob();
		const buffer = await blob.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
		return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
	} catch (e) {
		console.log("[COSE] douban 手动头像转换失败:", e.message);
		return avatarUrl;
	}
}
/**
* Douban platform detection logic
* Strategy:
* 1. Check dbcl2 cookie on douban.com as login indicator
* 2. Parse /mine/ HTML to get user info
* 3. Fallback: derive uid from dbcl2 cookie
* 4. If avatar missing but uid exists, fetch profile page
*/
async function detectDoubanUser() {
	try {
		const dbcl2Cookie = await chrome.cookies.get({
			url: "https://www.douban.com",
			name: "dbcl2"
		});
		if (!dbcl2Cookie || !dbcl2Cookie.value) {
			console.log("[COSE] douban 未找到登录 cookie，未登录");
			return { loggedIn: false };
		}
		let username = "";
		let avatar = "";
		let uid = "";
		let loginConfirmed = false;
		try {
			const cookieHeader = (await chrome.cookies.getAll({ domain: ".douban.com" })).map((c) => `${c.name}=${c.value}`).join("; ");
			const response = await fetch("https://www.douban.com/mine/", {
				method: "GET",
				credentials: "include",
				headers: {
					Accept: "text/html,application/xhtml+xml",
					...cookieHeader ? { Cookie: cookieHeader } : {}
				}
			});
			if (response.ok) {
				const finalUrl = response.url || "";
				const html = await response.text();
				const redirectedToLogin = /\/accounts\/login/i.test(finalUrl) || /name=["']form_email["']/i.test(html) || /登录豆瓣|扫码登录/i.test(html);
				const hasUserSignals = /的账号</.test(html) || /https?:\/\/www\.douban\.com\/people\/([^/"?#]+)\/?/.test(html) || /\/people\/([^/"?#]+)\/?/.test(html) || /doubanio\.com\/icon\//i.test(html);
				loginConfirmed = !redirectedToLogin && hasUserSignals;
				if (!username) {
					const accountMatch = html.match(/>([^<\n]+)的账号</);
					if (accountMatch?.[1]) username = accountMatch[1].trim();
				}
				if (!username || !uid) {
					const profileLinkMatch = html.match(/https?:\/\/www\.douban\.com\/people\/([^/"?#]+)\/?/);
					if (profileLinkMatch?.[1]) uid = profileLinkMatch[1];
				}
				if (!avatar) {
					const avatarMatch = html.match(/https?:\/\/img\d\.doubanio\.com\/icon\/[^"'\s<]+/i) || html.match(/\/\/img\d\.doubanio\.com\/icon\/[^"'\s<]+/i) || html.match(/\/icon\/up\d+-\d+\.jpg/i);
					if (avatarMatch?.[1]) avatar = avatarMatch[1];
					else if (avatarMatch?.[0]) avatar = avatarMatch[0];
					if (avatar && avatar.startsWith("//")) avatar = `https:${avatar}`;
					else if (avatar && avatar.startsWith("/icon/")) avatar = `https://img3.doubanio.com${avatar}`;
				}
				if (username || avatar || uid) console.log("[COSE] douban 从 /mine/ HTML 获取用户信息:", username || uid);
			}
		} catch (e) {
			console.log("[COSE] douban /mine/ 解析失败:", e.message);
		}
		if (loginConfirmed && !username && !uid && dbcl2Cookie.value) {
			const uidFromCookie = dbcl2Cookie.value.match(/"?([^:"]+):/);
			if (uidFromCookie?.[1]) uid = uidFromCookie[1];
		}
		if (!loginConfirmed) {
			console.log("[COSE] douban 仅有 cookie，未确认登录态，按未登录处理");
			return { loggedIn: false };
		}
		if (!username && uid) username = uid;
		if (!avatar && uid) try {
			const cookieHeader = (await chrome.cookies.getAll({ domain: ".douban.com" })).map((c) => `${c.name}=${c.value}`).join("; ");
			const profileResp = await fetch(`https://www.douban.com/people/${uid}/`, {
				method: "GET",
				credentials: "include",
				headers: {
					Accept: "text/html,application/xhtml+xml",
					...cookieHeader ? { Cookie: cookieHeader } : {}
				}
			});
			if (profileResp.ok) {
				const profileHtml = await profileResp.text();
				const profileAvatar = profileHtml.match(/https?:\/\/img\d\.doubanio\.com\/icon\/[^"'\s<]+/i) || profileHtml.match(/\/\/img\d\.doubanio\.com\/icon\/[^"'\s<]+/i);
				if (profileAvatar?.[0]) {
					avatar = profileAvatar[0];
					console.log("[COSE] douban 从个人页补充头像成功");
				}
			}
		} catch (e) {
			console.log("[COSE] douban 从个人页补充头像失败:", e.message);
		}
		if (avatar && avatar.startsWith("//")) avatar = `https:${avatar}`;
		if (avatar && avatar.startsWith("http")) try {
			avatar = await convertToBase64WithFallback(avatar);
		} catch (e) {
			console.log("[COSE] douban 头像转换失败:", e.message);
		}
		return {
			loggedIn: true,
			username: username || "",
			avatar: avatar || ""
		};
	} catch (e) {
		console.log("[COSE] douban 检测失败:", e.message);
		return { loggedIn: false };
	}
}
//#endregion
//#region ../../packages/detection/src/detect.js
var PLATFORM_DETECTORS = {
	csdn: detectCSDNUser,
	oschina: detectOSChinaUser,
	alipayopen: detectAlipayUser,
	weibo: detectWeiboUser,
	wechat: detectWechatUser,
	xiaohongshu: detectXiaohongshuUser,
	elecfans: detectElecfansUser,
	huaweicloud: detectHuaweiCloudUser,
	huaweidev: detectHuaweiDevUser,
	sspai: detectSspaiUser,
	aliyun: detectAliyunUser,
	sohu: detectSohuUser,
	medium: detectMediumUser,
	tencentcloud: detectTencentCloudUser,
	qianfan: detectQianfanUser,
	twitter: detectTwitterUser,
	bilibili: detectBilibiliUser,
	cto51: detectCTO51User,
	jianshu: detectJianshuUser,
	segmentfault: detectSegmentFaultUser,
	infoq: detectInfoQUser,
	modelscope: detectModelScopeUser,
	volcengine: detectVolcengineUser,
	cnblogs: detectCnblogsUser,
	wangyihao: detectWangyihaoUser,
	douban: detectDoubanUser
};
async function detectUser(platformId) {
	console.log(`[COSE] Detection: Checking ${platformId}`);
	if (PLATFORM_DETECTORS[platformId]) return PLATFORM_DETECTORS[platformId]();
	const config = LOGIN_CHECK_CONFIG[platformId];
	if (config) {
		if (config.useCookie || config.cookieNames && config.cookieNames.length > 0) return checkLoginByCookie(platformId, config);
		if (config.api) return detectByApi(platformId, config);
	}
	return {
		loggedIn: false,
		error: "No detection available"
	};
}
//#endregion
//#region ../../packages/core/src/utils.js
/**
* 注入通用工具函数到页面主世界
* 此函数会在页面中定义 window.waitFor 和 window.setInputValue
*/
function injectCommonUtils() {
	window.waitFor = (selector, timeout = 1e4) => {
		return new Promise((resolve) => {
			const el = document.querySelector(selector);
			if (el) return resolve(el);
			const observer = new MutationObserver(() => {
				const el = document.querySelector(selector);
				if (el) {
					observer.disconnect();
					resolve(el);
				}
			});
			observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			setTimeout(() => {
				observer.disconnect();
				resolve(document.querySelector(selector));
			}, timeout);
		});
	};
	window.setInputValue = (el, value) => {
		if (!el || !value) return;
		el.focus();
		if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
			const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
			if (nativeSetter) nativeSetter.call(el, value);
			else el.value = value;
			el.dispatchEvent(new Event("input", { bubbles: true }));
			el.dispatchEvent(new Event("change", { bubbles: true }));
		} else if (el.contentEditable === "true") {
			el.innerHTML = value.replace(/\n/g, "<br>");
			el.dispatchEvent(new Event("input", { bubbles: true }));
		}
	};
	return true;
}
/**
* 在页面中注入通用工具函数
* @param {object} chrome - Chrome API 对象
* @param {number} tabId - 目标 tab ID
* @returns {Promise<void>}
*/
async function injectUtils(chrome, tabId) {
	await chrome.scripting.executeScript({
		target: { tabId },
		func: injectCommonUtils,
		world: "MAIN"
	});
}
//#endregion
//#region ../../packages/core/src/platforms/csdn.js
var CSDNPlatform = {
	id: "csdn",
	name: "CSDN",
	icon: "https://g.csdnimg.cn/static/logo/favicon32.ico",
	url: "https://blog.csdn.net",
	publishUrl: "https://editor.csdn.net/md/",
	title: "CSDN",
	type: "csdn"
};
function fillCSDNContent(title, markdown, body) {
	const contentToFill = markdown ?? body ?? "";
	async function fill() {
		const titleInput = await window.waitFor(".article-bar__title input, input[placeholder*=\"标题\"]");
		if (titleInput && title) {
			titleInput.focus();
			titleInput.value = title;
			titleInput.dispatchEvent(new Event("input", { bubbles: true }));
		}
		await new Promise((resolve) => setTimeout(resolve, 1e3));
		const editor = document.querySelector(".editor__inner[contenteditable=\"true\"], [contenteditable=\"true\"].markdown-highlighting");
		if (editor) {
			editor.focus();
			editor.textContent = "";
			editor.textContent = contentToFill;
			editor.dispatchEvent(new Event("input", { bubbles: true }));
			console.log("[COSE] CSDN contenteditable 填充成功");
			return {
				success: true,
				method: "contenteditable"
			};
		} else {
			const cmElement = document.querySelector(".CodeMirror");
			if (cmElement && cmElement.CodeMirror) {
				cmElement.CodeMirror.setValue(contentToFill);
				console.log("[COSE] CSDN CodeMirror 填充成功");
				return {
					success: true,
					method: "CodeMirror"
				};
			} else {
				console.log("[COSE] CSDN 未找到编辑器元素");
				return {
					success: false,
					error: "Editor not found"
				};
			}
		}
	}
	return fill();
}
/**
* CSDN 同步处理器
* @param {object} tab - Chrome tab 对象
* @param {object} content - 内容对象 { title, body, markdown }
* @param {object} helpers - 帮助函数 { chrome, waitForTab, addTabToSyncGroup }
* @returns {Promise<{success: boolean, message?: string, tabId?: number}>}
*/
async function syncCSDNContent(tab, content, helpers) {
	const { chrome } = helpers;
	await new Promise((resolve) => setTimeout(resolve, 2e3));
	await injectUtils(chrome, tab.id);
	if (helpers.images?.prepare) content = await helpers.images.prepare(tab);
	const fillResult = (await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: fillCSDNContent,
		args: [
			content.title,
			content.markdown,
			content.body
		],
		world: "MAIN"
	}))?.[0]?.result;
	if (fillResult?.success) return {
		success: true,
		message: "已同步到 CSDN",
		tabId: tab.id
	};
	else return {
		success: false,
		message: fillResult?.error || "内容填充失败",
		tabId: tab.id
	};
}
//#endregion
//#region ../../packages/core/src/platforms/juejin.js
var JuejinPlatform = {
	id: "juejin",
	name: "Juejin",
	icon: "https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png",
	url: "https://juejin.cn",
	publishUrl: "https://juejin.cn/editor/drafts/new",
	title: "掘金",
	type: "juejin"
};
function fillJuejinContent(title, markdown, body) {
	const contentToFill = markdown ?? body ?? "";
	async function fill() {
		const titleInput = await window.waitFor("input[placeholder*=\"标题\"]");
		if (titleInput && title) {
			titleInput.focus();
			titleInput.value = title;
			titleInput.dispatchEvent(new Event("input", { bubbles: true }));
		}
		await new Promise((resolve) => setTimeout(resolve, 1e3));
		const cmElement = document.querySelector(".CodeMirror");
		if (cmElement && cmElement.CodeMirror) {
			cmElement.CodeMirror.setValue(contentToFill);
			console.log("[COSE] 掘金 CodeMirror 填充成功");
			return {
				success: true,
				method: "CodeMirror"
			};
		} else {
			const textarea = document.querySelector(".bytemd-body textarea");
			if (textarea) {
				textarea.focus();
				textarea.value = contentToFill;
				textarea.dispatchEvent(new Event("input", { bubbles: true }));
				console.log("[COSE] 掘金 textarea 填充成功");
				return {
					success: true,
					method: "textarea"
				};
			} else {
				console.log("[COSE] 掘金 未找到编辑器");
				return {
					success: false,
					error: "Editor not found"
				};
			}
		}
	}
	return fill();
}
/**
* 掘金同步处理器
* @param {object} tab - Chrome tab 对象
* @param {object} content - 内容对象 { title, body, markdown }
* @param {object} helpers - 帮助函数 { chrome, waitForTab, addTabToSyncGroup }
* @returns {Promise<{success: boolean, message?: string, tabId?: number}>}
*/
async function syncJuejinContent(tab, content, helpers) {
	const { chrome } = helpers;
	await new Promise((resolve) => setTimeout(resolve, 2e3));
	await injectUtils(chrome, tab.id);
	if (helpers.images?.prepare) content = await helpers.images.prepare(tab);
	const fillResult = (await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: fillJuejinContent,
		args: [
			content.title,
			content.markdown,
			content.body
		],
		world: "MAIN"
	}))?.[0]?.result;
	if (fillResult?.success) return {
		success: true,
		message: "已同步到掘金",
		tabId: tab.id
	};
	else return {
		success: false,
		message: fillResult?.error || "内容填充失败",
		tabId: tab.id
	};
}
//#endregion
//#region ../../packages/core/src/platforms/wechat.js
var WechatPlatform = {
	id: "wechat",
	name: "WeChat",
	icon: "https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico",
	url: "https://mp.weixin.qq.com",
	publishUrl: "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10",
	title: "微信公众号",
	type: "wechat"
};
async function fillWechatContent(title, htmlBody) {
	/**
	* 后台改版后可能存在多个 `.ProseMirror`（标题区也可能是 ProseMirror），
	* `querySelector('.ProseMirror')` 常会命中标题编辑器，导致正文 HTML 被贴进标题。
	* 另外，正文编辑器有时会比标题编辑器晚挂载，这时也要继续等待，不能把唯一节点误判成正文。
	*/
	function pickWechatBodyProseMirror() {
		function getEditorArea(editor) {
			return (editor?.clientHeight || 0) * (editor?.clientWidth || 0);
		}
		function isWechatTitleEditor(editor, titleEditor) {
			return Boolean(editor) && (editor === titleEditor || Boolean(editor.closest?.(".title-editor__input")));
		}
		function pickCandidate(nodes, { titleInput, titleEditor } = {}) {
			const bodyCandidates = nodes.filter((editor) => !isWechatTitleEditor(editor, titleEditor));
			if (bodyCandidates.length === 0) return null;
			if (bodyCandidates.length === 1) return bodyCandidates[0];
			const byPlaceholder = bodyCandidates.find((editor) => (editor.textContent || "").includes("从这里开始写正文"));
			if (byPlaceholder) return byPlaceholder;
			if (titleInput) {
				const band = titleInput.getBoundingClientRect();
				const belowTitle = bodyCandidates.filter((editor) => {
					return editor.getBoundingClientRect().top >= band.bottom - 8;
				});
				if (belowTitle.length > 0) return belowTitle.sort((a, b) => getEditorArea(b) - getEditorArea(a))[0];
			}
			return bodyCandidates.sort((a, b) => getEditorArea(b) - getEditorArea(a))[0];
		}
		const nodes = [...document.querySelectorAll(".ProseMirror")];
		if (nodes.length === 0) return null;
		return pickCandidate(nodes, {
			titleInput: document.querySelector("#title"),
			titleEditor: document.querySelector(".title-editor__input .ProseMirror")
		});
	}
	async function waitForBodyEditor(timeout = 15e3) {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			const el = pickWechatBodyProseMirror();
			if (el) return el;
			await new Promise((r) => setTimeout(r, 100));
		}
		return pickWechatBodyProseMirror();
	}
	try {
		const titleInput = await window.waitFor("#title", 15e3);
		const titleEditor = await window.waitFor(".title-editor__input .ProseMirror", 15e3);
		if ((titleInput || titleEditor) && title) {
			if (titleEditor) {
				titleEditor.focus();
				titleEditor.innerHTML = "";
				titleEditor.textContent = title;
				titleEditor.dispatchEvent(new Event("input", { bubbles: true }));
				titleEditor.dispatchEvent(new Event("change", { bubbles: true }));
			}
			if (titleInput) titleInput.focus();
			const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
			if (titleInput && nativeSetter) nativeSetter.call(titleInput, title);
			else if (titleInput) titleInput.value = title;
			if (titleInput) {
				titleInput.dispatchEvent(new Event("input", { bubbles: true }));
				titleInput.dispatchEvent(new Event("change", { bubbles: true }));
			}
			console.log("[COSE] 微信标题已填充:", title);
		}
		await new Promise((r) => setTimeout(r, 300));
		const editor = await waitForBodyEditor(15e3);
		if (!editor) return {
			success: false,
			error: "未找到正文编辑器"
		};
		if (editor && htmlBody) {
			editor.focus();
			if (editor.textContent.includes("从这里开始写正文")) editor.innerHTML = "";
			const plainText = htmlBody.replace(/<[^>]*>/g, "");
			const hasImageInSource = /<img\b/i.test(htmlBody);
			let injected = false;
			let injectError = "";
			if (window.__MP_Editor_JSAPI__ && typeof window.__MP_Editor_JSAPI__.invoke === "function") {
				injected = await new Promise((resolve) => {
					let done = false;
					const finish = (ok, err) => {
						if (done) return;
						done = true;
						if (err) injectError = err.message || String(err);
						resolve(ok);
					};
					try {
						window.__MP_Editor_JSAPI__.invoke({
							apiName: "mp_editor_set_content",
							apiParam: { content: htmlBody },
							sucCb: () => finish(true),
							errCb: (err) => finish(false, err)
						});
					} catch (err) {
						finish(false, err);
					}
					setTimeout(() => finish(false, /* @__PURE__ */ new Error("mp_editor_set_content 调用超时")), 5e3);
				});
				if (injected) {
					console.log("[COSE] 微信内容已通过 mp_editor_set_content 注入");
					await new Promise((r) => setTimeout(r, 800));
				} else console.warn("[COSE] mp_editor_set_content 注入失败:", injectError);
			}
			if (!injected) {
				if (hasImageInSource) console.warn("[COSE] 正文包含图片，但微信 JSAPI 不可用；paste 兜底可能无法保留图片");
				const dt = new DataTransfer();
				dt.setData("text/html", htmlBody);
				dt.setData("text/plain", plainText);
				const pasteEvent = new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData: dt
				});
				editor.dispatchEvent(pasteEvent);
				console.log("[COSE] 微信内容已通过 paste 事件注入（兜底方案）");
				await new Promise((r) => setTimeout(r, 800));
			}
			const wordCount = editor.textContent?.trim().length || 0;
			const imageCount = editor.querySelectorAll?.("img").length || 0;
			const hasEditorContent = wordCount > 0 || imageCount > 0 || injected;
			return {
				success: hasEditorContent,
				error: hasEditorContent ? void 0 : injectError || "正文注入后未检测到有效内容",
				wordCount,
				imageCount,
				titleFilled: titleInput?.value === title || titleEditor?.textContent?.trim() === title
			};
		}
		return {
			success: false,
			error: "内容为空"
		};
	} catch (err) {
		return {
			success: false,
			error: err.message
		};
	}
}
function saveWechatDraft() {
	const saveDraftBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("保存为草稿"));
	if (saveDraftBtn) {
		saveDraftBtn.click();
		console.log("[COSE] 已点击保存为草稿");
		return { success: true };
	}
	return {
		success: false,
		error: "未找到保存按钮"
	};
}
/**
* 微信公众号同步处理器
* @param {object} tab - Chrome tab 对象（初始为首页）
* @param {object} content - 内容对象 { title, body, markdown, wechatHtml }
* @param {object} helpers - 帮助函数 { chrome, waitForTab, addTabToSyncGroup, PLATFORMS }
* @returns {Promise<{success: boolean, message?: string, tabId?: number}>}
*/
async function syncWechatContent(tab, content, helpers) {
	const { chrome, waitForTab } = helpers;
	console.log("[COSE] 微信公众号等待页面加载");
	await waitForTab(tab.id);
	await injectUtils(chrome, tab.id);
	console.log("[COSE] 开始检测 token...");
	const [tokenResult] = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => {
			return new Promise((resolve) => {
				const checkToken = () => {
					const urlMatch = window.location.href.match(/token=(\d+)/);
					if (urlMatch) return urlMatch[1];
					const links = document.querySelectorAll("a[href*=\"token\"]");
					for (const link of links) {
						const match = link.href?.match(/token=(\d+)/);
						if (match) return match[1];
					}
					const scripts = document.querySelectorAll("script:not([src])");
					for (const script of scripts) {
						const match = script.textContent.match(/token["']?\s*[:=]\s*["']?(\d+)["']?/i);
						if (match && match[1]) return match[1];
					}
					return null;
				};
				const existing = checkToken();
				if (existing) return resolve(existing);
				const observer = new MutationObserver(() => {
					const token = checkToken();
					if (token) {
						observer.disconnect();
						resolve(token);
					}
				});
				observer.observe(document.documentElement, {
					childList: true,
					subtree: true
				});
				setTimeout(() => {
					observer.disconnect();
					resolve(checkToken());
				}, 1e4);
			});
		},
		world: "MAIN"
	});
	const token = tokenResult?.result;
	if (!token) {
		console.error("[COSE] 无法从页面获取 token");
		return {
			success: false,
			message: "无法获取微信公众号 token，请确保已登录",
			tabId: tab.id
		};
	}
	const editorUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&token=${token}&lang=zh_CN`;
	console.log("[COSE] 获取到 token:", token, "跳转到编辑器");
	await chrome.tabs.update(tab.id, { url: editorUrl });
	await waitForTab(tab.id);
	if (helpers.images?.prepare) content = await helpers.images.prepare(tab);
	const htmlContent = content.wechatHtml || content.body;
	console.log("[COSE] 微信 HTML 内容长度:", htmlContent?.length || 0);
	console.log("[COSE] 正在等待编辑器...");
	const [editorResult] = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => {
			return new Promise((resolve) => {
				if (document.querySelector(".ProseMirror")) return resolve(true);
				const observer = new MutationObserver(() => {
					if (document.querySelector(".ProseMirror")) {
						observer.disconnect();
						resolve(true);
					}
				});
				observer.observe(document.documentElement, {
					childList: true,
					subtree: true
				});
				setTimeout(() => {
					observer.disconnect();
					resolve(!!document.querySelector(".ProseMirror"));
				}, 15e3);
			});
		},
		world: "MAIN"
	});
	if (!editorResult?.result) {
		console.error("[COSE] 编辑器等待超时");
		return {
			success: false,
			message: "编辑器加载超时",
			tabId: tab.id
		};
	}
	console.log("[COSE] 编辑器已就绪，开始注入内容...");
	await injectUtils(chrome, tab.id);
	let result;
	try {
		result = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: fillWechatContent,
			args: [content.title, htmlContent],
			world: "MAIN"
		});
	} catch (e) {
		console.error("[COSE] executeScript 执行失败:", e);
		return {
			success: false,
			message: "脚本执行失败: " + e.message,
			tabId: tab.id
		};
	}
	const fillResult = result?.[0]?.result;
	console.log("[COSE] 微信填充结果:", JSON.stringify(fillResult, null, 2));
	if (!fillResult?.success) {
		console.error("[COSE] 微信内容填充失败:", fillResult?.error);
		return {
			success: false,
			message: fillResult?.error || "内容填充失败",
			tabId: tab.id
		};
	}
	console.log("[COSE] 微信内容填充成功，字数:", fillResult.wordCount);
	await helpers.images?.cover?.(tab);
	await new Promise((resolve) => setTimeout(resolve, 500));
	await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: saveWechatDraft,
		world: "MAIN"
	});
	return {
		success: true,
		message: "已同步并保存为草稿",
		tabId: tab.id
	};
}
//#endregion
//#region ../../packages/core/src/platforms/zhihu.js
var ZhihuPlatform = {
	id: "zhihu",
	name: "Zhihu",
	icon: "https://static.zhihu.com/heifetz/favicon.ico",
	url: "https://www.zhihu.com",
	publishUrl: "https://zhuanlan.zhihu.com/write",
	title: "知乎",
	type: "zhihu"
};
async function fillZhihuContent(title, markdown, body, usePreparedHtml = false) {
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const editorSelector = ".public-DraftEditor-content[contenteditable=\"true\"]";
	const getEditor = () => document.querySelector(editorSelector) || document.querySelector("[contenteditable=\"true\"]");
	async function waitAndClickButton(matches, timeout = 5e3) {
		const deadline = Date.now() + timeout;
		do {
			const button = Array.from(document.querySelectorAll("button")).find((btn) => !btn.disabled && btn.getClientRects().length && matches(btn.textContent.trim()));
			if (button) {
				button.click();
				return true;
			}
			await sleep(200);
		} while (Date.now() < deadline);
		return false;
	}
	const source = document.createElement("template");
	source.innerHTML = body || "";
	const expectedImages = source.content.querySelectorAll("img[src]").length;
	const hasSourceImages = expectedImages > 0 || !body && /!\[[^\]]*\](?:\(|\[)|<img\b/i.test(markdown || "");
	await sleep(2e3);
	const titleInput = await window.waitFor("textarea[placeholder*=\"标题\"]");
	const editor = getEditor();
	if (!titleInput || !editor) return {
		success: false,
		error: "未找到知乎编辑器，请确认已登录知乎"
	};
	if (editor.textContent.trim() || editor.querySelector("img, figure")) return {
		success: false,
		error: "知乎编辑器已有内容，请在空白文章中重试"
	};
	window.setInputValue(titleInput, title);
	await sleep(500);
	if (!(usePreparedHtml ? body : markdown)?.trim()) {
		if (source.content.textContent.trim() || hasSourceImages) return {
			success: false,
			error: "缺少 Markdown 原文，无法导入知乎正文"
		};
		return {
			success: true,
			hasImages: false
		};
	}
	const rect = editor.getBoundingClientRect();
	for (const type of [
		"mousedown",
		"mouseup",
		"click"
	]) editor.dispatchEvent(new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		view: window,
		clientX: rect.left + rect.width / 2,
		clientY: rect.top + rect.height / 2,
		button: 0
	}));
	editor.focus();
	if (!editor.contains(document.activeElement)) return {
		success: false,
		error: "无法激活知乎正文编辑器"
	};
	try {
		const clipboardData = new DataTransfer();
		if (usePreparedHtml) {
			clipboardData.setData("text/html", body);
			clipboardData.setData("text/plain", source.content.textContent || "");
		} else clipboardData.setData("text/plain", markdown);
		editor.dispatchEvent(new ClipboardEvent("paste", {
			bubbles: true,
			cancelable: true,
			clipboardData
		}));
		if (!usePreparedHtml && await waitAndClickButton((text) => text.includes("确认并解析")) && !await waitAndClickButton((text) => text === "确认")) return {
			success: false,
			error: "知乎 Markdown 解析未完成，请在编辑器中检查"
		};
	} catch (error) {
		console.warn("[COSE] 知乎正文导入失败:", error);
		return {
			success: false,
			error: "知乎正文粘贴失败，请在编辑器中检查"
		};
	}
	const deadline = Date.now() + (hasSourceImages ? Math.min(18e4, 3e4 + expectedImages * 2500) : 3e3);
	let hasImages = hasSourceImages;
	let savedImages = 0;
	do {
		const currentEditor = getEditor();
		const figures = currentEditor?.querySelectorAll("figure") ?? [];
		if (Array.from(figures).some((figure) => figure.textContent.trim() === "上传失败" && !figure.querySelector("img[src]"))) return {
			success: false,
			error: "知乎显示图片上传失败，请在草稿中检查失败图片及其原始链接"
		};
		hasImages ||= Boolean(currentEditor?.querySelector("img"));
		if (!hasImages && currentEditor?.textContent.trim()) return {
			success: true,
			hasImages: false
		};
		const draftId = location.pathname.match(/^\/p\/(\d+)\/edit\/?$/)?.[1];
		if (hasImages && draftId) try {
			const response = await fetch(`/api/articles/${draftId}/draft`, {
				cache: "no-store",
				signal: AbortSignal.timeout(3e3)
			});
			if (response.ok) {
				const draft = await response.json();
				if (typeof draft.content === "string" && (!title || draft.title === title)) {
					const saved = document.createElement("template");
					saved.innerHTML = draft.content;
					savedImages = Array.from(saved.content.querySelectorAll("img[src]")).filter((image) => {
						const url = URL.parse(image.getAttribute("src"));
						return url?.protocol === "https:" && (url.hostname.endsWith(".zhimg.com") || url.hostname === "pic-private.zhihu.com");
					}).length;
					if (savedImages >= Math.max(1, expectedImages)) return {
						success: true,
						hasImages: true
					};
				}
			}
		} catch {}
		await sleep(hasImages ? 1e3 : 250);
	} while (Date.now() < deadline);
	return {
		success: false,
		error: hasImages ? `知乎图片未全部保存（已确认 ${savedImages} 张${expectedImages ? `，原文 ${expectedImages} 张` : ""}），请在草稿中检查图片或原始链接` : "知乎正文未导入，请在编辑器中检查"
	};
}
/**
* 知乎同步处理器
* 知乎现在支持直接粘贴 Markdown，然后弹窗提示转换
* @param {object} tab - Chrome tab 对象
* @param {object} content - 内容对象 { title, body, markdown }
* @param {object} helpers - 帮助函数 { chrome, waitForTab, addTabToSyncGroup }
* @returns {Promise<{success: boolean, message?: string, tabId?: number}>}
*/
async function syncZhihuContent(tab, content, helpers) {
	const { waitForTab } = helpers;
	await waitForTab(tab.id);
	try {
		await chrome.tabs.update(tab.id, { active: true });
		console.log("[COSE] 已激活知乎标签页");
		await new Promise((resolve) => setTimeout(resolve, 500));
	} catch (err) {
		console.log("[COSE] 激活标签页失败:", err.message || err);
	}
	await injectUtils(globalThis.chrome, tab.id);
	if (helpers.images?.prepare) content = await helpers.images.prepare(tab);
	const fillResult = (await globalThis.chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: fillZhihuContent,
		args: [
			content.title,
			content.preparedHtml ? "" : content.markdown || "",
			content.body || "",
			content.preparedHtml === true
		],
		world: "MAIN"
	}))?.[0]?.result;
	if (!fillResult?.success) return {
		success: false,
		message: fillResult?.error || "内容同步失败",
		tabId: tab.id
	};
	if (!fillResult.hasImages) await new Promise((resolve) => setTimeout(resolve, 2e3));
	try {
		await chrome.tabs.reload(tab.id, { bypassCache: false });
	} catch (err) {
		console.log("[COSE] 刷新知乎页面失败:", err.message || err);
	}
	return {
		success: true,
		message: "已打开知乎并同步内容",
		tabId: tab.id
	};
}
//#endregion
//#region ../../packages/core/src/platforms/toutiao.js
var ToutiaoPlatform = {
	id: "toutiao",
	name: "Toutiao",
	icon: "https://sf3-cdn-tos.toutiaostatic.com/obj/eden-cn/uhbfnupkbps/toutiao_favicon.ico",
	url: "https://mp.toutiao.com",
	publishUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
	title: "今日头条",
	type: "toutiao"
};
function fillToutiaoContentInPage(title, body) {
	function waitForElement(predicate, timeout = 1e4) {
		return new Promise((resolve) => {
			const el = predicate();
			if (el) return resolve(el);
			const observer = new MutationObserver(() => {
				const el = predicate();
				if (el) {
					observer.disconnect();
					resolve(el);
				}
			});
			observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			setTimeout(() => {
				observer.disconnect();
				resolve(predicate());
			}, timeout);
		});
	}
	async function fillContent() {
		const titleInput = await waitForElement(() => document.querySelector("textarea[placeholder*=\"标题\"]"));
		if (titleInput && title) {
			titleInput.focus();
			Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(titleInput, title);
			titleInput.dispatchEvent(new InputEvent("input", {
				bubbles: true,
				data: title,
				inputType: "insertText"
			}));
			titleInput.dispatchEvent(new Event("change", { bubbles: true }));
			titleInput.dispatchEvent(new Event("blur", { bubbles: true }));
			console.log("[COSE] 头条标题填充成功:", title);
		} else console.log("[COSE] 头条未找到标题输入框");
		await new Promise((resolve) => setTimeout(resolve, 500));
		const editor = await waitForElement(() => document.querySelector(".ProseMirror"));
		if (editor && body) {
			editor.focus();
			editor.innerHTML = "";
			const lines = body.split("\n").filter((line) => line.trim() !== "");
			const selection = window.getSelection();
			const range = document.createRange();
			range.selectNodeContents(editor);
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
			const htmlContent = lines.map((line) => `<p>${line}</p>`).join("");
			document.execCommand("insertHTML", false, htmlContent);
			editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
			editor.dispatchEvent(new Event("change", { bubbles: true }));
			console.log("[COSE] 头条内容填充成功");
			return { success: true };
		} else {
			console.log("[COSE] 头条未找到编辑器");
			return {
				success: false,
				error: "未找到编辑器"
			};
		}
	}
	return fillContent();
}
/**
* 今日头条同步处理器
* @param {object} tab - Chrome tab 对象
* @param {object} content - 内容对象 { title, body, markdown }
* @param {object} helpers - 帮助函数 { chrome, waitForTab, addTabToSyncGroup }
* @returns {Promise<{success: boolean, message?: string, tabId?: number}>}
*/
async function syncToutiaoContent(tab, content, helpers) {
	const { chrome, waitForTab } = helpers;
	await waitForTab(tab.id);
	await new Promise((resolve) => setTimeout(resolve, 2500));
	await injectUtils(chrome, tab.id);
	if (helpers.images?.prepare) content = await helpers.images.prepare(tab);
	const fillResult = (await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: fillToutiaoContentInPage,
		args: [content.title, content.body || content.markdown || ""],
		world: "MAIN"
	}))?.[0]?.result;
	if (fillResult?.success) return {
		success: true,
		message: "已打开头条号并填充内容",
		tabId: tab.id
	};
	else return {
		success: false,
		message: fillResult?.error || "内容填充失败",
		tabId: tab.id
	};
}
//#endregion
//#region ../../packages/core/src/platforms/segmentfault.js
var SegmentFaultPlatform = {
	id: "segmentfault",
	name: "SegmentFault",
	icon: "https://fastly.jsdelivr.net/gh/bucketio/img16@main/2026/02/01/1769960912823-e037663a-7f65-414e-a114-ed86b4e86964.png",
	url: "https://segmentfault.com",
	publishUrl: "https://segmentfault.com/write",
	title: "思否",
	type: "segmentfault"
};
//#endregion
//#region ../../packages/core/src/platforms/cnblogs.js
var CnblogsPlatform = {
	id: "cnblogs",
	name: "Cnblogs",
	icon: "https://www.cnblogs.com/favicon.ico",
	url: "https://www.cnblogs.com",
	publishUrl: "https://i.cnblogs.com/posts/edit",
	title: "博客园",
	type: "cnblogs"
};
//#endregion
//#region ../../packages/core/src/platforms/oschina.js
var OSChinaPlatform = {
	id: "oschina",
	name: "OSChina",
	icon: "https://wsrv.nl/?url=static.oschina.net/new-osc/img/favicon.ico",
	url: "https://www.oschina.net",
	publishUrl: "https://my.oschina.net/blog/ai-write",
	title: "开源中国",
	type: "oschina"
};
//#endregion
//#region ../../packages/core/src/platforms/cto51.js
var CTO51Platform = {
	id: "cto51",
	name: "51CTO",
	icon: "https://blog.51cto.com/favicon.ico",
	url: "https://blog.51cto.com",
	loginUrl: "https://home.51cto.com/index/login",
	publishUrl: "https://blog.51cto.com/blogger/publish",
	title: "51CTO",
	type: "cto51"
};
//#endregion
//#region ../../packages/core/src/platforms/infoq.js
var InfoQPlatform = {
	id: "infoq",
	name: "InfoQ",
	icon: "https://static001.infoq.cn/static/write/img/write-favicon.jpg",
	url: "https://xie.infoq.cn",
	publishUrl: "https://xie.infoq.cn/draft/write",
	createDraftApi: "https://xie.infoq.cn/api/v1/draft/create",
	title: "InfoQ",
	type: "infoq"
};
//#endregion
//#region ../../packages/core/src/platforms/jianshu.js
var JianshuPlatform = {
	id: "jianshu",
	name: "Jianshu",
	icon: "https://www.jianshu.com/favicon.ico",
	url: "https://www.jianshu.com",
	publishUrl: "https://www.jianshu.com/writer",
	title: "简书",
	type: "jianshu"
};
//#endregion
//#region ../../packages/core/src/platforms/baijiahao.js
var BaijiahaoPlat = {
	id: "baijiahao",
	name: "Baijiahao",
	icon: "https://pic.rmb.bdstatic.com/10e1e2b43c35577e1315f0f6aad6ba24.vnd.microsoft.icon",
	url: "https://baijiahao.baidu.com",
	publishUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
	title: "百家号",
	type: "baijiahao"
};
//#endregion
//#region ../../packages/core/src/platforms/wangyihao.js
var WangyihaoPlatform = {
	id: "wangyihao",
	name: "Wangyihao",
	icon: "https://static.ws.126.net/163/f2e/news/yxybd_pc/resource/static/share-icon.png",
	url: "https://mp.163.com",
	publishUrl: "https://mp.163.com/#/article-publish",
	title: "网易号",
	type: "wangyihao"
};
function fillWangyihaoContent(title, htmlBody) {
	async function fill() {
		const titleInput = await window.waitFor("textarea.netease-textarea", 1e4) || await window.waitFor("textarea[placeholder*=\"标题\"]", 3e3);
		if (titleInput && title) {
			titleInput.focus();
			Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(titleInput, title);
			titleInput.dispatchEvent(new InputEvent("input", {
				bubbles: true,
				data: title,
				inputType: "insertText"
			}));
			titleInput.dispatchEvent(new Event("change", { bubbles: true }));
			titleInput.dispatchEvent(new Event("blur", { bubbles: true }));
			console.log("[COSE] 网易号标题已填充");
		} else console.log("[COSE] 网易号未找到标题输入框");
		const editor = await window.waitFor(".public-DraftEditor-content", 1e4) || await window.waitFor("[contenteditable=\"true\"]", 3e3);
		if (editor && htmlBody) {
			editor.focus();
			const placeholder = editor.querySelector("[data-text=\"true\"]");
			if (placeholder && placeholder.textContent.includes("请输入正文")) editor.innerHTML = "";
			const dt = new DataTransfer();
			dt.setData("text/html", htmlBody);
			dt.setData("text/plain", htmlBody.replace(/<[^>]*>/g, ""));
			const pasteEvent = new ClipboardEvent("paste", {
				bubbles: true,
				cancelable: true,
				clipboardData: dt
			});
			editor.dispatchEvent(pasteEvent);
			console.log("[COSE] 网易号内容已通过 paste 事件注入");
			return { success: true };
		} else {
			console.log("[COSE] 网易号未找到编辑器元素");
			return {
				success: false,
				error: "Editor not found"
			};
		}
	}
	return fill();
}
/**
* 网易号同步处理器
* 网易号使用剪贴板 HTML 粘贴到 Draft.js 编辑器
* @param {object} tab - Chrome tab 对象
* @param {object} content - 内容对象 { title, body, markdown, wechatHtml }
* @param {object} helpers - 帮助函数 { chrome, waitForTab, addTabToSyncGroup }
* @returns {Promise<{success: boolean, message?: string, tabId?: number}>}
*/
async function syncWangyihaoContent(tab, content, helpers) {
	const { chrome, waitForTab } = helpers;
	await waitForTab(tab.id);
	await injectUtils(chrome, tab.id);
	if (helpers.images?.prepare) content = await helpers.images.prepare(tab);
	const htmlContent = content.wechatHtml || content.body;
	console.log("[COSE] 网易号 HTML 内容长度:", htmlContent?.length || 0);
	const fillResult = (await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: fillWangyihaoContent,
		args: [content.title, htmlContent],
		world: "MAIN"
	}))?.[0]?.result;
	if (fillResult?.success) return {
		success: true,
		message: "已同步到网易号",
		tabId: tab.id
	};
	else return {
		success: false,
		message: fillResult?.error || "网易号内容填充失败",
		tabId: tab.id
	};
}
//#endregion
//#region ../../packages/core/src/platforms/tencentcloud.js
var TencentCloudPlatform = {
	id: "tencentcloud",
	name: "TencentCloud",
	icon: "https://cloudcache.tencent-cloud.com/qcloud/favicon.ico",
	url: "https://cloud.tencent.com/developer",
	publishUrl: "https://cloud.tencent.com/developer/article/write-new",
	title: "腾讯云开发者社区",
	type: "tencentcloud"
};
//#endregion
//#region ../../packages/core/src/platforms/medium.js
var MediumPlatform = {
	id: "medium",
	name: "Medium",
	icon: "https://cdn.simpleicons.org/medium",
	url: "https://medium.com",
	publishUrl: "https://medium.com/new-story",
	title: "Medium",
	type: "medium"
};
//#endregion
//#region ../../packages/core/src/platforms/sspai.js
var SspaiPlatform = {
	id: "sspai",
	name: "Sspai",
	icon: "https://cdn-static.sspai.com/favicon/sspai.ico",
	url: "https://sspai.com",
	loginUrl: "https://sspai.com/write",
	publishUrl: "https://sspai.com/write",
	title: "少数派",
	type: "sspai"
};
//#endregion
//#region ../../packages/core/src/platforms/sohu.js
var SohuPlatform = {
	id: "sohu",
	name: "Sohu",
	icon: "https://statics.itc.cn/mp-new/icon/1.1/favicon.ico",
	url: "https://mp.sohu.com",
	publishUrl: "https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1",
	title: "搜狐号",
	type: "sohu"
};
//#endregion
//#region ../../packages/core/src/platforms/bilibili.js
var BilibiliPlatform = {
	id: "bilibili",
	name: "Bilibili",
	icon: "https://www.bilibili.com/favicon.ico",
	url: "https://member.bilibili.com",
	publishUrl: "https://member.bilibili.com/york/read-editor",
	title: "B站专栏",
	type: "bilibili"
};
async function fillBilibiliDraftInPage(title, html) {
	async function waitFor(read, timeout) {
		const until = Date.now() + timeout;
		do {
			const value = read();
			if (value) return value;
			await new Promise((resolve) => setTimeout(resolve, 150));
		} while (Date.now() < until);
		return null;
	}
	const editor = await waitFor(() => document.querySelector(".editor-container .ProseMirror[contenteditable=\"true\"]"), 15e3);
	if (!editor) return {
		success: false,
		message: "B站正文编辑器未就绪，请确认已登录并可创建专栏"
	};
	const titleInput = document.querySelector("textarea.title-input__inner");
	const counter = document.querySelector(".extension-suffix .counter");
	const wordCount = () => Number.parseInt(counter?.textContent, 10);
	const draftButton = Array.from(document.querySelectorAll(".publish-footer .footer-right button")).find((button) => [
		"保存为草稿",
		"儲存為草稿",
		"Save as draft"
	].includes(button.textContent.trim()));
	if (!titleInput || !counter || !draftButton) return {
		success: false,
		message: "B站专栏缺少可用的标题、字数统计或草稿按钮"
	};
	const images = () => editor.editor?.storage?.biliImage?.allImages || [];
	if (wordCount() !== 0 || titleInput.value || editor.textContent?.trim() || images().length) return {
		success: false,
		message: "B站打开的草稿已有内容，已停止写入"
	};
	titleInput.value = title;
	titleInput.dispatchEvent(new Event("input", { bubbles: true }));
	editor.focus();
	const data = new DataTransfer();
	data.setData("text/html", html);
	data.setData("text/plain", "");
	editor.dispatchEvent(new ClipboardEvent("paste", {
		bubbles: true,
		cancelable: true,
		clipboardData: data
	}));
	const source = document.createElement("template");
	source.innerHTML = html;
	const expected = source.content.querySelectorAll("img[src]").length;
	const imageOnly = expected > 0 && !source.content.textContent.trim();
	if (!await waitFor(() => wordCount() > 0 || imageOnly && images().length >= expected, 5e3)) return {
		success: false,
		message: "B站未识别正文（字数为 0），已停止保存"
	};
	if (expected > 0) {
		let uploaded = 0;
		let failed = 0;
		if (!await waitFor(() => {
			const current = images();
			uploaded = current.filter((image) => image.attrs.status === 1).length;
			failed = current.filter((image) => image.attrs.status != null && ![0, 1].includes(image.attrs.status)).length;
			return failed > 0 || current.length >= expected && uploaded === current.length;
		}, Math.min(18e4, 3e4 + expected * 2500)) || failed) return {
			success: false,
			message: `B站图片已上传 ${uploaded}/${expected} 张，${failed ? `${failed} 张失败` : "其余图片尚未确认"}。请在当前编辑页检查后保存`
		};
	}
	const saveTip = () => document.querySelector(".extension-suffix .save-tip");
	const previousTip = saveTip()?.textContent;
	if (!await waitFor(() => !draftButton.disabled, 5e3)) return {
		success: false,
		message: "B站草稿保存按钮暂不可用，请在当前编辑页检查"
	};
	draftButton.click();
	const confirmed = await waitFor(() => {
		const tip = saveTip();
		return tip?.textContent && tip.textContent !== previousTip && tip;
	}, 15e3);
	if (!confirmed) return {
		success: false,
		message: "B站尚未确认草稿保存，请在编辑器中检查"
	};
	if (confirmed.classList.contains("save-fail")) return {
		success: false,
		message: confirmed.textContent
	};
	return {
		success: true,
		message: "B站已确认保存专栏草稿"
	};
}
async function syncBilibiliContent(tab, content, { chrome, waitForTab, images }) {
	await waitForTab(tab.id);
	if (images?.prepare) content = await images.prepare(tab);
	const html = content.wechatHtml || content.body;
	if (!html?.trim()) return {
		success: false,
		message: "没有可同步到B站的正文"
	};
	const [frame] = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		world: "MAIN",
		func: fillBilibiliDraftInPage,
		args: [content.title || "", html]
	});
	return {
		...frame?.result || {
			success: false,
			message: "B站编辑器未返回同步结果"
		},
		tabId: tab.id
	};
}
//#endregion
//#region ../../packages/core/src/platforms/weibo.js
var WeiboPlatform = {
	id: "weibo",
	name: "Weibo",
	icon: "https://weibo.com/favicon.ico",
	url: "https://weibo.com",
	publishUrl: "https://card.weibo.com/article/v5/editor#/draft",
	title: "微博头条",
	type: "weibo"
};
//#endregion
//#region ../../packages/core/src/platforms/aliyun.js
var AliyunPlatform = {
	id: "aliyun",
	name: "Aliyun",
	icon: "https://img.alicdn.com/tfs/TB1_ZXuNcfpK1RjSZFOXXa6nFXa-32-32.ico",
	url: "https://developer.aliyun.com/",
	publishUrl: "https://developer.aliyun.com/article/new#/",
	title: "阿里云开发者社区",
	type: "aliyun"
};
//#endregion
//#region ../../packages/core/src/platforms/huaweicloud.js
var HuaweiCloudPlatform = {
	id: "huaweicloud",
	name: "HuaweiCloud",
	icon: "https://www.huaweicloud.com/favicon.ico",
	url: "https://bbs.huaweicloud.com/blogs/article",
	publishUrl: "https://bbs.huaweicloud.com/blogs/article",
	title: "华为云开发者博客",
	type: "huaweicloud"
};
//#endregion
//#region ../../packages/core/src/platforms/huaweidev.js
var HuaweiDevPlatform = {
	id: "huaweidev",
	name: "HuaweiDev",
	icon: "https://developer.huawei.com/favicon.ico",
	url: "https://developer.huawei.com/consumer/cn/",
	publishUrl: "https://developer.huawei.com/consumer/cn/blog/create",
	title: "华为开发者文章",
	type: "huaweidev"
};
//#endregion
//#region ../../packages/core/src/platforms/twitter.js
var TwitterPlatform = {
	id: "twitter",
	name: "Twitter",
	icon: "https://abs.twimg.com/favicons/twitter.3.ico",
	url: "https://x.com",
	publishUrl: "https://x.com/compose/articles/edit/",
	title: "Twitter Articles",
	type: "twitter"
};
//#endregion
//#region ../../packages/core/src/platforms/qianfan.js
var QianfanPlatform = {
	id: "qianfan",
	name: "Qianfan",
	icon: "https://bce.bdstatic.com/img/favicon.ico",
	url: "https://qianfan.cloud.baidu.com/qianfandev",
	publishUrl: "https://qianfan.cloud.baidu.com/qianfandev/topic/create",
	title: "百度云千帆",
	type: "qianfan"
};
function qianfanIntercept() {
	if (!location.href.includes("qianfan.cloud.baidu.com")) return;
	const INTERCEPT_PATTERN = "/api/community/topic";
	const LOGIN_URL_PATTERN = "login.bce.baidu.com";
	let blockedCount = 0;
	const FAKE_RESPONSE = JSON.stringify({
		success: true,
		status: 200,
		result: { id: "cose-intercepted" }
	});
	console.log("[COSE] 千帆拦截器开始安装...");
	const originalFetch = window.fetch;
	window.fetch = function(...args) {
		const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
		const method = ((args[1] || {}).method || args[0]?.method || "GET").toUpperCase();
		if (url.includes(INTERCEPT_PATTERN) && method === "POST") {
			console.log("[COSE] 拦截 fetch POST:", url, "(已拦截", ++blockedCount, "个)");
			return Promise.resolve(new Response(FAKE_RESPONSE, {
				status: 200,
				headers: { "Content-Type": "application/json" }
			}));
		}
		return originalFetch.apply(this, args);
	};
	const originalXHROpen = XMLHttpRequest.prototype.open;
	const originalXHRSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.open = function(method, url, ...rest) {
		this._coseUrl = url;
		this._coseMethod = (method || "GET").toUpperCase();
		return originalXHROpen.call(this, method, url, ...rest);
	};
	XMLHttpRequest.prototype.send = function(body) {
		if (this._coseUrl?.includes(INTERCEPT_PATTERN) && this._coseMethod === "POST") {
			console.log("[COSE] 拦截 XHR POST:", this._coseUrl, "(已拦截", ++blockedCount, "个)");
			const self = this;
			setTimeout(() => {
				Object.defineProperty(self, "readyState", {
					get: () => 4,
					configurable: true
				});
				Object.defineProperty(self, "status", {
					get: () => 200,
					configurable: true
				});
				Object.defineProperty(self, "statusText", {
					get: () => "OK",
					configurable: true
				});
				Object.defineProperty(self, "responseText", {
					get: () => FAKE_RESPONSE,
					configurable: true
				});
				Object.defineProperty(self, "response", {
					get: () => FAKE_RESPONSE,
					configurable: true
				});
				self.dispatchEvent(new Event("readystatechange"));
				self.dispatchEvent(new Event("load"));
				self.dispatchEvent(new Event("loadend"));
				if (typeof self.onreadystatechange === "function") self.onreadystatechange();
				if (typeof self.onload === "function") self.onload();
			}, 10);
			return;
		}
		return originalXHRSend.call(this, body);
	};
	const originalSendBeacon = navigator.sendBeacon?.bind(navigator);
	if (originalSendBeacon) navigator.sendBeacon = function(url, data) {
		if (url?.includes(INTERCEPT_PATTERN)) {
			console.log("[COSE] 拦截 sendBeacon:", url, "(已拦截", ++blockedCount, "个)");
			return true;
		}
		return originalSendBeacon(url, data);
	};
	const origAssign = window.location.assign.bind(window.location);
	const origReplace = window.location.replace.bind(window.location);
	window.location.assign = function(url) {
		if (typeof url === "string" && url.includes(LOGIN_URL_PATTERN)) {
			console.log("[COSE] 拦截 location.assign 跳转到登录页:", url);
			return;
		}
		return origAssign(url);
	};
	window.location.replace = function(url) {
		if (typeof url === "string" && url.includes(LOGIN_URL_PATTERN)) {
			console.log("[COSE] 拦截 location.replace 跳转到登录页:", url);
			return;
		}
		return origReplace(url);
	};
	const originalOpen = window.open;
	window.open = function(url, ...rest) {
		if (typeof url === "string" && url.includes(LOGIN_URL_PATTERN)) {
			console.log("[COSE] 拦截 window.open 跳转到登录页:", url);
			return null;
		}
		return originalOpen.call(this, url, ...rest);
	};
	if (window.navigation) window.navigation.addEventListener("navigate", (e) => {
		const destUrl = e.destination?.url || "";
		console.log("[COSE] Navigation API navigate 事件:", destUrl);
		if (destUrl.includes(LOGIN_URL_PATTERN)) {
			console.log("[COSE] 拦截 Navigation API 跳转到登录页");
			e.preventDefault();
		}
	});
	const origPushState = history.pushState.bind(history);
	const origReplaceState = history.replaceState.bind(history);
	history.pushState = function(state, title, url) {
		if (typeof url === "string" && url.includes(LOGIN_URL_PATTERN)) {
			console.log("[COSE] 拦截 pushState 跳转到登录页:", url);
			return;
		}
		return origPushState(state, title, url);
	};
	history.replaceState = function(state, title, url) {
		if (typeof url === "string" && url.includes(LOGIN_URL_PATTERN)) {
			console.log("[COSE] 拦截 replaceState 跳转到登录页:", url);
			return;
		}
		return origReplaceState(state, title, url);
	};
	console.log("[COSE] 千帆拦截器安装完成（fetch/XHR/sendBeacon/location/navigation）");
}
//#endregion
//#region ../../packages/core/src/platforms/index.js
var PLATFORMS = [
	CSDNPlatform,
	JuejinPlatform,
	WechatPlatform,
	ZhihuPlatform,
	ToutiaoPlatform,
	SegmentFaultPlatform,
	CnblogsPlatform,
	OSChinaPlatform,
	CTO51Platform,
	InfoQPlatform,
	JianshuPlatform,
	BaijiahaoPlat,
	WangyihaoPlatform,
	TencentCloudPlatform,
	MediumPlatform,
	SspaiPlatform,
	SohuPlatform,
	BilibiliPlatform,
	WeiboPlatform,
	AliyunPlatform,
	HuaweiCloudPlatform,
	HuaweiDevPlatform,
	TwitterPlatform,
	QianfanPlatform,
	{
		id: "alipayopen",
		name: "AlipayOpen",
		icon: "https://www.alipay.com/favicon.ico",
		url: "https://open.alipay.com",
		publishUrl: "https://open.alipay.com/portal/forum/post/add#article",
		title: "支付宝开放平台",
		type: "alipayopen"
	},
	{
		id: "modelscope",
		name: "ModelScope",
		icon: "https://img.alicdn.com/imgextra/i4/O1CN01fvt4it25rEZU4Gjso_!!6000000007579-2-tps-128-128.png",
		url: "https://modelscope.cn",
		publishUrl: "https://modelscope.cn/learn/create",
		title: "ModelScope 魔搭社区",
		type: "modelscope"
	},
	{
		id: "volcengine",
		name: "Volcengine",
		icon: "https://lf1-cdn-tos.bytegoofy.com/goofy/tech-fe/fav.png",
		url: "https://developer.volcengine.com/",
		publishUrl: "https://developer.volcengine.com/articles/draft",
		title: "火山引擎开发者社区",
		type: "volcengine"
	},
	{
		id: "douyin",
		name: "Douyin",
		icon: "https://lf3-static.bytednsdoc.com/obj/eden-cn/yvahlyj_upfbvk_zlp/ljhwZthlaukjlkulzlp/pc_creator/favicon_v2_7145ff0.ico",
		url: "https://creator.douyin.com/",
		publishUrl: "https://creator.douyin.com/creator-micro/content/post/article?default-tab=5&enter_from=publish_page&media_type=article&type=new",
		title: "抖音",
		type: "douyin"
	},
	{
		id: "xiaohongshu",
		name: "Xiaohongshu",
		icon: "https://www.xiaohongshu.com/favicon.ico",
		url: "https://creator.xiaohongshu.com",
		publishUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
		title: "小红书",
		type: "xiaohongshu"
	},
	{
		id: "elecfans",
		name: "电子发烧友",
		icon: "https://www.elecfans.com/favicon.ico",
		publishUrl: "https://www.elecfans.com/d/article/md/",
		loginUrl: "https://bbs.elecfans.com/member.php?mod=logging&action=login"
	},
	{
		id: "douban",
		name: "Douban",
		icon: "https://cdn.simpleicons.org/douban/07C160",
		url: "https://www.douban.com",
		publishUrl: "https://www.douban.com/",
		title: "豆瓣",
		type: "douban"
	}
];
var SYNC_HANDLERS = {
	csdn: syncCSDNContent,
	juejin: syncJuejinContent,
	wechat: syncWechatContent,
	zhihu: syncZhihuContent,
	bilibili: syncBilibiliContent,
	toutiao: syncToutiaoContent,
	wangyihao: syncWangyihaoContent
};
//#endregion
//#region src/sync-receiver.js
async function readSyncContent(request, sender, tabs) {
	if (!request.transfer) return request.content;
	const { id, length } = request.transfer;
	if (!sender.tab?.id || !id || !Number.isSafeInteger(length) || length <= 0) throw new Error("成稿传输信息不完整，请刷新编辑器后重试");
	const target = sender.documentId ? { documentId: sender.documentId } : { frameId: sender.frameId };
	const parts = [];
	let offset = 0;
	while (offset < length) {
		const part = await tabs.sendMessage(sender.tab.id, {
			type: "READ_SYNC_CHUNK",
			id,
			offset
		}, target);
		if (typeof part !== "string" || !part.length || offset + part.length > length) throw new Error("成稿传输中断，请保持编辑器打开后重试");
		parts.push(part);
		offset += part.length;
	}
	return JSON.parse(parts.join(""));
}
async function retryTabEdit(operation) {
	for (let attempt = 0;; attempt++) try {
		return await operation();
	} catch (error) {
		if (attempt >= 5 || !/Tabs cannot be edited right now/i.test(error.message)) throw error;
		await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
	}
}
//#endregion
//#region src/background.js
async function ensureOffscreen() {
	try {
		if (!await chrome.offscreen.hasDocument()) {
			await chrome.offscreen.createDocument({
				url: "offscreen.html",
				reasons: ["DOM_SCRAPING"],
				justification: "Fetch with credentials in document context for login detection"
			});
			if (!await _waitForOffscreenReady(3e3)) console.warn("[COSE] ensureOffscreen: offscreen document did not become ready in time");
		}
	} catch (e) {
		console.log("[COSE] ensureOffscreen error:", e.message);
	}
}
/**
* Ping the offscreen document until it responds, confirming its listener is active.
*/
async function _waitForOffscreenReady(timeoutMs = 3e3) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const resp = await chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" });
			if (resp && resp.pong) return true;
		} catch (e) {}
		await new Promise((r) => setTimeout(r, 50));
	}
	return false;
}
/**
* Warm-up fetch via offscreen document.
* This triggers the browser's cookie restoration (SSO, session cookies)
* by making a fetch with credentials: 'include' in a document context.
*/
async function warmUpFetch(url) {
	try {
		const result = await sendOffscreenMessage({
			type: "OFFSCREEN_WARM_FETCH",
			payload: { url }
		});
		console.log(`[COSE] Warm-up fetch ${url}: status=${result?.data?.status}`);
		return result;
	} catch (e) {
		console.log(`[COSE] Warm-up fetch failed for ${url}:`, e.message);
		return null;
	}
}
/**
* API fetch via offscreen document.
* Makes a fetch with credentials: 'include' in a document context,
* so cookies are automatically attached (unlike service worker fetch which strips Cookie headers).
*/
async function offscreenApiFetch(url, options = {}) {
	try {
		const result = await sendOffscreenMessage({
			type: "OFFSCREEN_API_FETCH",
			payload: {
				url,
				...options
			}
		});
		console.log(`[COSE] Offscreen API fetch ${url}: status=${result?.data?.status}`);
		return result?.data || null;
	} catch (e) {
		console.log(`[COSE] Offscreen API fetch failed for ${url}:`, e.message);
		return null;
	}
}
globalThis.__coseWarmUpFetch = warmUpFetch;
globalThis.__coseOffscreenApiFetch = offscreenApiFetch;
/**
* Serialized message sender for offscreen document.
* chrome.runtime.sendMessage is broadcast-based; when multiple OFFSCREEN_*
* messages are sent concurrently, responses can get mixed up or lost.
* This queue ensures only one offscreen message is in-flight at a time.
* Includes a timeout to prevent the queue from getting stuck if the offscreen
* document is garbage-collected or fails to respond.
*/
var _offscreenQueue = Promise.resolve();
function sendOffscreenMessage(msg, timeoutMs = 15e3) {
	const p = _offscreenQueue.then(async () => {
		await ensureOffscreen();
		return Promise.race([chrome.runtime.sendMessage(msg), new Promise((_, reject) => setTimeout(() => reject(/* @__PURE__ */ new Error(`Offscreen message timeout (${msg.type})`)), timeoutMs))]);
	});
	_offscreenQueue = p.catch(() => {});
	return p;
}
/**
* Execute a fetch in the context of a target site's tab.
* This is needed for sites whose auth cookies are SameSite=Lax (default),
* which won't be sent from cross-site contexts like offscreen documents.
*
* Strategy: find an existing tab for the domain, or create a temporary one,
* then inject a script that makes the fetch with credentials: 'include'.
*/
async function tabContextFetch(siteUrl, apiUrl, options = {}) {
	const { responseType = "json", timeout = 15e3 } = options;
	let createdTabId = null;
	try {
		const pattern = `*://*.${new URL(siteUrl).hostname.replace(/^www\./, "")}/*`;
		console.log(`[COSE] tabContextFetch: looking for tabs matching ${pattern}`);
		let tabs = await chrome.tabs.query({ url: pattern });
		let tab = tabs.find((t) => t.id && !t.discarded);
		console.log(`[COSE] tabContextFetch: found ${tabs.length} tabs, usable: ${tab ? tab.id : "none"}`);
		if (!tab) {
			tab = await chrome.tabs.create({
				url: siteUrl,
				active: false
			});
			createdTabId = tab.id;
			console.log(`[COSE] tabContextFetch: created background tab ${tab.id}`);
			if ((await chrome.tabs.get(tab.id)).status !== "complete") await new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					chrome.tabs.onUpdated.removeListener(listener);
					reject(/* @__PURE__ */ new Error("Tab load timeout"));
				}, timeout);
				const listener = (tabId, info) => {
					if (tabId === tab.id && info.status === "complete") {
						chrome.tabs.onUpdated.removeListener(listener);
						clearTimeout(timer);
						resolve();
					}
				};
				chrome.tabs.onUpdated.addListener(listener);
			});
		}
		const results = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: async (fetchUrl, respType) => {
				try {
					const resp = await fetch(fetchUrl, {
						method: "GET",
						credentials: "include",
						headers: { Accept: respType === "json" ? "application/json" : "text/html" }
					});
					const status = resp.status;
					const finalUrl = resp.url;
					let body = null;
					if (respType === "json") try {
						body = await resp.json();
					} catch (e) {
						body = null;
					}
					else body = await resp.text();
					return {
						status,
						url: finalUrl,
						body
					};
				} catch (e) {
					return { error: e.message };
				}
			},
			args: [apiUrl, responseType],
			world: "MAIN"
		});
		if (createdTabId) try {
			await chrome.tabs.remove(createdTabId);
		} catch (e) {}
		console.log(`[COSE] tabContextFetch result:`, JSON.stringify(results?.[0]?.result).substring(0, 200));
		return results?.[0]?.result || null;
	} catch (e) {
		if (createdTabId) try {
			await chrome.tabs.remove(createdTabId);
		} catch (e2) {}
		console.log(`[COSE] tabContextFetch failed for ${apiUrl}:`, e.message);
		return null;
	}
}
globalThis.__coseTabContextFetch = tabContextFetch;
/**
* 51CTO detection via offscreen document (爱贝壳 approach).
* Offscreen has document context so DOMParser is available.
* Includes retry logic in case the offscreen document wasn't ready on first attempt.
*/
async function detectCto51ViaOffscreen() {
	for (let attempt = 1; attempt <= 2; attempt++) try {
		console.log(`[COSE] 51CTO: Sending OFFSCREEN_DETECT_CTO51 (attempt ${attempt})...`);
		const result = await sendOffscreenMessage({ type: "OFFSCREEN_DETECT_CTO51" });
		console.log("[COSE] 51CTO: Offscreen response:", JSON.stringify(result));
		if (result === void 0 || result === null) {
			console.warn("[COSE] 51CTO: Got empty response, offscreen may not be ready");
			if (attempt < 2) {
				await new Promise((r) => setTimeout(r, 500));
				continue;
			}
		}
		return result?.data || null;
	} catch (e) {
		console.log(`[COSE] 51CTO offscreen detection failed (attempt ${attempt}):`, e.message);
		if (attempt < 2) {
			await new Promise((r) => setTimeout(r, 500));
			continue;
		}
		return null;
	}
	return null;
}
globalThis.__coseDetectCto51 = detectCto51ViaOffscreen;
/**
* Cnblogs detection via offscreen document.
* Offscreen has document context so cookies are sent automatically.
*/
async function detectCnblogsViaOffscreen() {
	try {
		console.log("[COSE] Cnblogs: Sending OFFSCREEN_DETECT_CNBLOGS message...");
		const result = await sendOffscreenMessage({ type: "OFFSCREEN_DETECT_CNBLOGS" });
		console.log("[COSE] Cnblogs: Offscreen response:", JSON.stringify(result));
		return result?.data || null;
	} catch (e) {
		console.log("[COSE] Cnblogs offscreen detection failed:", e.message);
		return null;
	}
}
globalThis.__coseDetectCnblogs = detectCnblogsViaOffscreen;
/**
* Xiaohongshu detection via offscreen document.
* Offscreen has document context so cookies are sent automatically.
*/
async function detectXiaohongshuViaOffscreen() {
	try {
		console.log("[COSE] Xiaohongshu: Sending OFFSCREEN_DETECT_XIAOHONGSHU message...");
		const result = await sendOffscreenMessage({ type: "OFFSCREEN_DETECT_XIAOHONGSHU" });
		console.log("[COSE] Xiaohongshu: Offscreen response:", JSON.stringify(result));
		return result?.data || null;
	} catch (e) {
		console.log("[COSE] Xiaohongshu offscreen detection failed:", e.message);
		return null;
	}
}
globalThis.__coseDetectXiaohongshu = detectXiaohongshuViaOffscreen;
async function initDynamicRules() {
	try {
		const existingIds = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
		if (existingIds.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
		await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [{
			id: 1,
			priority: 100,
			action: {
				type: "modifyHeaders",
				requestHeaders: [{
					header: "Referer",
					operation: "set",
					value: "https://weibo.com/"
				}, {
					header: "Origin",
					operation: "set",
					value: "https://weibo.com"
				}],
				responseHeaders: [{
					header: "Access-Control-Allow-Origin",
					operation: "set",
					value: "*"
				}]
			},
			condition: {
				urlFilter: "*sinaimg.cn*",
				resourceTypes: ["image", "xmlhttprequest"]
			}
		}, {
			id: 2,
			priority: 100,
			action: {
				type: "modifyHeaders",
				requestHeaders: [{
					header: "Referer",
					operation: "set",
					value: "https://sspai.com/"
				}, {
					header: "Origin",
					operation: "set",
					value: "https://sspai.com"
				}],
				responseHeaders: [{
					header: "Access-Control-Allow-Origin",
					operation: "set",
					value: "*"
				}]
			},
			condition: {
				urlFilter: "*cdnfile.sspai.com*",
				resourceTypes: ["image", "xmlhttprequest"]
			}
		}] });
		console.log("[COSE] 动态规则初始化完成");
	} catch (e) {
		console.error("[COSE] 动态规则初始化失败:", e);
	}
}
chrome.runtime.onInstalled.addListener(() => {
	initDynamicRules();
});
chrome.runtime.onStartup.addListener(() => {
	initDynamicRules();
});
var currentSyncGroupId = null;
async function addTabToSyncGroup(tabId, windowId) {
	try {
		if (currentSyncGroupId === null) {
			currentSyncGroupId = await retryTabEdit(() => chrome.tabs.group({ tabIds: tabId }));
			const now = /* @__PURE__ */ new Date();
			const timestamp = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
			await chrome.tabGroups.update(currentSyncGroupId, {
				title: `${timestamp}`,
				color: "blue",
				collapsed: false
			});
		} else await retryTabEdit(() => chrome.tabs.group({
			tabIds: tabId,
			groupId: currentSyncGroupId
		}));
	} catch (error) {
		console.error("[COSE] 添加标签到组失败:", error);
	}
}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.type && request.type.startsWith("OFFSCREEN_")) return false;
	if (request.type === "GET_DEBUG_LOGS") {
		chrome.storage.local.get("debug_logs", (result) => {
			sendResponse({ logs: result.debug_logs || [] });
		});
		return true;
	}
	(async () => {
		try {
			sendResponse(await handleMessage(request, sender));
		} catch (err) {
			console.error("[COSE] 消息处理错误:", err);
			sendResponse({ error: err.message || "未知错误" });
		}
	})();
	return true;
});
async function handleMessage(request, sender) {
	console.log(`[COSE] handleMessage received type: ${request.type}`);
	switch (request.type) {
		case "GET_PLATFORMS": return { platforms: PLATFORMS };
		case "CHECK_PLATFORM_STATUS": return { status: await checkAllPlatforms(request.platforms || PLATFORMS) };
		case "CHECK_PLATFORM_STATUS_PROGRESSIVE":
			checkAllPlatformsProgressive(request.platforms || PLATFORMS, sender.tab?.id);
			return {
				started: true,
				total: (request.platforms || PLATFORMS).length
			};
		case "START_SYNC_BATCH":
			currentSyncGroupId = null;
			return { success: true };
		case "SYNC_TO_PLATFORM": return await syncDraftWithImages(request.platformId, await readSyncContent(request, sender, chrome.tabs));
		case "CACHE_USER_INFO":
			if (request.platform === "xiaohongshu" && request.userInfo) {
				await chrome.storage.local.set({ xiaohongshu_user: request.userInfo });
				console.log("[COSE] 小红书用户信息已缓存:", request.userInfo.username);
			} else if (request.platform === "alipayopen" && request.userInfo) {
				await chrome.storage.local.set({ alipayopen_user: request.userInfo });
				console.log("[COSE] 支付宝用户信息已缓存:", request.userInfo.username);
			} else if (request.platform === "huaweicloud" && request.userInfo) {
				const hwcInfo = { ...request.userInfo };
				if (hwcInfo.avatar && hwcInfo.avatar.startsWith("http")) hwcInfo.avatar = await convertAvatarToBase64(hwcInfo.avatar, "https://bbs.huaweicloud.com/");
				await chrome.storage.local.set({ huaweicloud_user: hwcInfo });
				console.log("[COSE] 华为云用户信息已缓存:", hwcInfo.username);
			} else if (request.platform === "huaweidev" && request.userInfo) {
				const hwdInfo = { ...request.userInfo };
				if (hwdInfo.avatar && hwdInfo.avatar.startsWith("http")) hwdInfo.avatar = await convertAvatarToBase64(hwdInfo.avatar, "https://developer.huawei.com/");
				await chrome.storage.local.set({ huaweidev_user: hwdInfo });
				console.log("[COSE] 华为开发者用户信息已缓存:", hwdInfo.username);
			}
			return { success: true };
		default: return { error: "Unknown message type" };
	}
}
async function checkAllPlatforms(platforms) {
	const status = {};
	try {
		const validPlatforms = (platforms || []).filter((p) => p && p.id);
		(await Promise.allSettled(validPlatforms.map(async (platform) => {
			try {
				const result = await checkPlatformLogin(platform);
				return {
					id: platform.id,
					result
				};
			} catch (e) {
				return {
					id: platform.id,
					result: {
						loggedIn: false,
						error: e.message
					}
				};
			}
		}))).forEach((res) => {
			if (res.status === "fulfilled" && res.value?.id) status[res.value.id] = res.value.result;
		});
	} catch (e) {
		console.error("[COSE] 检查平台状态失败:", e);
	}
	return status;
}
async function checkAllPlatformsProgressive(platforms, tabId) {
	const validPlatforms = (platforms || []).filter((p) => p && p.id);
	let completed = 0;
	const total = validPlatforms.length;
	const promises = validPlatforms.map(async (platform) => {
		try {
			const result = await checkPlatformLogin(platform);
			completed++;
			if (tabId) try {
				await chrome.tabs.sendMessage(tabId, {
					type: "PLATFORM_STATUS_UPDATE",
					platformId: platform.id,
					platform,
					result,
					completed,
					total
				});
			} catch (e) {
				console.log("[COSE] 发送平台状态更新失败:", platform.id, e.message);
			}
			return {
				id: platform.id,
				result
			};
		} catch (e) {
			completed++;
			const errorResult = {
				loggedIn: false,
				error: e.message
			};
			if (tabId) try {
				await chrome.tabs.sendMessage(tabId, {
					type: "PLATFORM_STATUS_UPDATE",
					platformId: platform.id,
					platform,
					result: errorResult,
					completed,
					total
				});
			} catch (e2) {
				console.log("[COSE] 发送平台状态更新失败:", platform.id, e2.message);
			}
			return {
				id: platform.id,
				result: errorResult
			};
		}
	});
	await Promise.allSettled(promises);
	if (tabId) try {
		await chrome.tabs.sendMessage(tabId, {
			type: "PLATFORM_STATUS_COMPLETE",
			total
		});
	} catch (e) {
		console.log("[COSE] 发送完成消息失败:", e.message);
	}
}
async function checkPlatformLogin(platform) {
	if (!platform || !platform.id) return {
		loggedIn: false,
		error: "无效的平台配置"
	};
	return await detectUser(platform.id);
}
async function syncDraftWithImages(platformId, content) {
	const platform = PLATFORMS.find((p) => p?.id === platformId);
	if (!platform || !content.images?.length) return syncToPlatform(platformId, content, {});
	const origin = new URL(platform.publishUrl).origin;
	async function upload(tab, image, cover = false) {
		const [reply] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			world: "MAIN",
			func: uploadInEditor,
			args: [
				image,
				cover,
				origin,
				3e4,
				platformId === "bilibili"
			]
		});
		if (!reply?.result?.ok) throw new Error(reply?.result?.error || "平台图片上传未完成");
		return reply.result.url;
	}
	let coverHandled = false;
	let warning;
	const images = {
		prepare: (tab) => resolveBodyImages(content, (image) => upload(tab, image), ["zhihu", "bilibili"].includes(platformId)),
		async cover(tab) {
			const image = content.images.find((image) => image.key === content.thumb);
			if (coverHandled || !image) return;
			coverHandled = true;
			try {
				await upload(tab, image, true);
			} catch (error) {
				warning = error.message;
			}
		}
	};
	const result = await syncToPlatform(platformId, content, images);
	if (result.success) await images.cover({ id: result.tabId });
	return {
		...result,
		warning
	};
}
async function syncToPlatform(platformId, content, images) {
	const platform = PLATFORMS.find((p) => p && p.id === platformId);
	if (!platform || !platform.publishUrl) return {
		success: false,
		message: "暂不支持该平台"
	};
	try {
		let tab;
		const syncHandler = SYNC_HANDLERS[platformId];
		if (syncHandler) {
			console.log(`[COSE] 使用 ${platformId} 平台特定同步处理器`);
			const initialUrl = platformId === "wechat" ? "https://mp.weixin.qq.com/" : platform.publishUrl;
			tab = await retryTabEdit(() => chrome.tabs.create({
				url: initialUrl,
				active: false
			}));
			await addTabToSyncGroup(tab.id, tab.windowId);
			const helpers = {
				chrome,
				waitForTab,
				addTabToSyncGroup,
				PLATFORMS,
				images
			};
			return await syncHandler(tab, content, helpers);
		}
		if (platformId === "infoq") try {
			const data = await (await fetch("https://xie.infoq.cn/api/v1/draft/create", {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json"
				}
			})).json();
			if (data.code === 0 && data.data?.id) {
				const draftId = data.data.id;
				const targetUrl = `https://xie.infoq.cn/draft/${draftId}`;
				console.log("[COSE] InfoQ 创建草稿成功，ID:", draftId);
				tab = await retryTabEdit(() => chrome.tabs.create({
					url: targetUrl,
					active: false
				}));
				await addTabToSyncGroup(tab.id, tab.windowId);
				await waitForTab(tab.id);
			} else {
				console.error("[COSE] InfoQ 创建草稿失败:", data);
				return {
					success: false,
					message: "InfoQ 创建草稿失败，请确保已登录"
				};
			}
		} catch (e) {
			console.error("[COSE] InfoQ API 调用失败:", e);
			return {
				success: false,
				message: "InfoQ API 调用失败: " + e.message
			};
		}
		else if (platformId === "jianshu") try {
			const notebooks = await (await fetch("https://www.jianshu.com/author/notebooks", {
				method: "GET",
				credentials: "include",
				headers: { Accept: "application/json" }
			})).json();
			if (!notebooks || notebooks.length === 0) return {
				success: false,
				message: "简书未找到文集，请先创建一个文集"
			};
			const notebookId = notebooks[0].id;
			console.log("[COSE] 简书使用文集:", notebooks[0].name, "ID:", notebookId);
			const noteData = await (await fetch("https://www.jianshu.com/author/notes", {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json"
				},
				body: JSON.stringify({
					notebook_id: String(notebookId),
					title: content.title || "无标题",
					at_bottom: false
				})
			})).json();
			if (noteData && noteData.id) {
				const noteId = noteData.id;
				const targetUrl = `https://www.jianshu.com/writer#/notebooks/${notebookId}/notes/${noteId}`;
				console.log("[COSE] 简书创建文章成功，ID:", noteId);
				tab = await retryTabEdit(() => chrome.tabs.create({
					url: targetUrl,
					active: false
				}));
				await addTabToSyncGroup(tab.id, tab.windowId);
				await waitForTab(tab.id);
			} else {
				console.error("[COSE] 简书创建文章失败:", noteData);
				return {
					success: false,
					message: "简书创建文章失败，请确保已登录"
				};
			}
		} catch (e) {
			console.error("[COSE] 简书 API 调用失败:", e);
			return {
				success: false,
				message: "简书 API 调用失败: " + e.message
			};
		}
		else if (platformId === "xiaohongshu") {
			console.log("[COSE] 开始处理小红书同步...");
			tab = await chrome.tabs.create({
				url: platform.publishUrl,
				active: false
			});
			await addTabToSyncGroup(tab.id, tab.windowId);
			await waitForTab(tab.id);
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const clickResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: async () => {
					const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
					const createBtn = Array.from(document.querySelectorAll("button")).find((el) => el.textContent.includes("新的创作"));
					if (createBtn) {
						createBtn.click();
						console.log("[COSE] 小红书已点击\"新的创作\"按钮");
						const waitForEditor = async (timeout = 1e4) => {
							const start = Date.now();
							while (Date.now() - start < timeout) {
								if (document.querySelector("[contenteditable=\"true\"]") || document.querySelector("textarea") || document.querySelector(".editor") || document.querySelector(".content-editor")) return true;
								await sleep(200);
							}
							return false;
						};
						const editorLoaded = await waitForEditor();
						return {
							success: editorLoaded,
							message: editorLoaded ? "Editor loaded" : "Editor timeout"
						};
					}
					return {
						success: false,
						message: "Create button not found"
					};
				}
			});
			if (!clickResult[0]?.result?.success) return {
				success: false,
				message: "小红书创建文章失败: " + (clickResult[0]?.result?.message || "未知错误")
			};
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			if (images.prepare) content = await images.prepare(tab);
			const htmlContent = content.wechatHtml || content.body;
			console.log("[COSE] 小红书 HTML 内容长度:", htmlContent?.length || 0);
			const fillResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: async (title, htmlBody) => {
					const waitForElement = (selector, timeout = 15e3) => {
						return new Promise((resolve) => {
							const el = document.querySelector(selector);
							if (el) return resolve(el);
							const observer = new MutationObserver(() => {
								const el = document.querySelector(selector);
								if (el) {
									observer.disconnect();
									resolve(el);
								}
							});
							observer.observe(document.body, {
								childList: true,
								subtree: true
							});
							setTimeout(() => {
								observer.disconnect();
								resolve(document.querySelector(selector));
							}, timeout);
						});
					};
					try {
						console.log("[COSE] 小红书开始填充内容...");
						const titleInput = await waitForElement("input[placeholder*=\"标题\"], textarea[placeholder*=\"标题\"], .title-input", 5e3);
						if (titleInput && title) {
							titleInput.focus();
							const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
							if (nativeSetter) nativeSetter.call(titleInput, title);
							else titleInput.value = title;
							titleInput.dispatchEvent(new Event("input", { bubbles: true }));
							titleInput.dispatchEvent(new Event("change", { bubbles: true }));
							console.log("[COSE] 小红书标题已填充:", title);
						}
						await new Promise((r) => setTimeout(r, 300));
						const contentEditor = await waitForElement("[contenteditable=\"true\"], .editor-content, .content-editor", 5e3);
						if (contentEditor && htmlBody) {
							contentEditor.focus();
							if (contentEditor.textContent.includes("从这里开始写正文") || contentEditor.textContent.includes("请输入正文") || contentEditor.textContent.includes("写点什么")) contentEditor.innerHTML = "";
							const dt = new DataTransfer();
							dt.setData("text/html", htmlBody);
							dt.setData("text/plain", htmlBody.replace(/<[^>]*>/g, ""));
							const pasteEvent = new ClipboardEvent("paste", {
								bubbles: true,
								cancelable: true,
								clipboardData: dt
							});
							contentEditor.dispatchEvent(pasteEvent);
							console.log("[COSE] 小红书内容已通过 paste 事件注入");
							await new Promise((r) => setTimeout(r, 500));
							if ((contentEditor.textContent?.length || 0) === 0) {
								console.log("[COSE] paste 事件未生效，尝试备用方案");
								contentEditor.innerHTML = htmlBody;
							}
							return {
								success: true,
								method: "paste-html",
								length: htmlBody.length
							};
						}
						return {
							success: false,
							error: "Content editor not found"
						};
					} catch (e) {
						console.error("[COSE] 小红书同步失败:", e);
						return {
							success: false,
							error: e.message
						};
					}
				},
				args: [content.title, htmlContent],
				world: "MAIN"
			});
			console.log("[COSE] 小红书填充结果:", fillResult[0]?.result);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			return {
				success: true,
				message: "已同步到小红书",
				tabId: tab.id
			};
		} else if (platformId === "twitter") {
			const [currentTab] = await chrome.tabs.query({
				active: true,
				currentWindow: true
			});
			tab = await chrome.tabs.create({
				url: platform.publishUrl,
				active: true
			});
			await addTabToSyncGroup(tab.id, tab.windowId);
			await waitForTab(tab.id);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			const clickResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: async () => {
					const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
					const createBtn = document.querySelector("button[aria-label=\"create\"]") || Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label")?.toLowerCase() === "create");
					if (createBtn) {
						createBtn.click();
						console.log("[COSE] Twitter Articles 已点击 create 按钮");
						const waitForEditor = async (timeout = 1e4) => {
							const start = Date.now();
							while (Date.now() - start < timeout) {
								if (document.querySelector("textarea[placeholder=\"Add a title\"]")) return true;
								await sleep(200);
							}
							return false;
						};
						const editorLoaded = await waitForEditor();
						return {
							success: editorLoaded,
							message: editorLoaded ? "Editor loaded" : "Editor timeout"
						};
					}
					return {
						success: false,
						message: "Create button not found"
					};
				},
				world: "MAIN"
			});
			console.log("[COSE] Twitter Articles create 结果:", clickResult[0]?.result);
			if (currentTab?.id) try {
				await chrome.tabs.update(currentTab.id, { active: true });
				console.log("[COSE] Twitter 已切回原 Tab");
			} catch (e) {}
			if (!clickResult[0]?.result?.success) return {
				success: false,
				message: "Twitter Articles 创建文章失败: " + (clickResult[0]?.result?.message || "未知错误")
			};
			await new Promise((resolve) => setTimeout(resolve, 500));
			if (images.prepare) content = await images.prepare(tab);
			const markdownContent = content.markdown ?? content.body ?? "";
			console.log("[COSE] Twitter Articles Markdown 内容长度:", markdownContent?.length || 0);
			const fillResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: async (title, markdown) => {
					const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
					const waitForElement = async (selector, timeout = 1e4) => {
						const start = Date.now();
						while (Date.now() - start < timeout) {
							const el = document.querySelector(selector);
							if (el) return el;
							await sleep(200);
						}
						return null;
					};
					function parseMarkdownToHtml(md) {
						if (!md) return "";
						const codeBlocks = [];
						const inlineCodes = [];
						const blockFormulas = [];
						const inlineFormulas = [];
						let html = md;
						html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
							const index = codeBlocks.length;
							codeBlocks.push({
								lang: lang || "",
								code
							});
							return `__CODE_BLOCK_${index}__`;
						});
						html = html.replace(/`([^`\n]+)`/g, (match, code) => {
							const index = inlineCodes.length;
							inlineCodes.push(code);
							return `__INLINE_CODE_${index}__`;
						});
						html = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
							const index = blockFormulas.length;
							blockFormulas.push(formula.trim());
							return `__BLOCK_FORMULA_${index}__`;
						});
						html = html.replace(/\$([^\$\n]+)\$/g, (match, formula) => {
							const index = inlineFormulas.length;
							inlineFormulas.push(formula.trim());
							return `__INLINE_FORMULA_${index}__`;
						});
						html = html.replace(/^#### (.+)$/gm, "<h3>$1</h3>");
						html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
						html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
						html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
						html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
						html = html.replace(/^---$/gm, "<p>---</p>");
						html = html.replace(/^\*\*\*$/gm, "<p>***</p>");
						html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "<img src=\"$2\" alt=\"$1\" style=\"max-width: 100%;\" />");
						html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href=\"$2\">$1</a>");
						html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
						html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
						html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
						codeBlocks.forEach((block, index) => {
							const formattedCode = block.code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").split("\n").filter((line) => line.trim()).join("<br>");
							const codeHtml = `<blockquote>${block.lang ? `<strong>${block.lang}</strong><br>` : ""}${formattedCode}</blockquote>`;
							html = html.replace(`__CODE_BLOCK_${index}__`, codeHtml);
						});
						inlineCodes.forEach((code, index) => {
							const codeHtml = `<code>${code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`;
							html = html.replace(`__INLINE_CODE_${index}__`, codeHtml);
						});
						blockFormulas.forEach((formula, index) => {
							const formulaHtml = `<div style="text-align: center; margin: 16px 0;"><img src="https://latex.codecogs.com/svg.image?${encodeURIComponent(formula)}" alt="${formula.replace(/"/g, "&quot;")}" style="max-width: 100%;" /></div>`;
							html = html.replace(`__BLOCK_FORMULA_${index}__`, formulaHtml);
						});
						inlineFormulas.forEach((formula, index) => {
							const formulaHtml = `<img src="https://latex.codecogs.com/svg.image?${encodeURIComponent(formula)}" alt="${formula.replace(/"/g, "&quot;")}" style="vertical-align: middle;" />`;
							html = html.replace(`__INLINE_FORMULA_${index}__`, formulaHtml);
						});
						html = html.replace(/^[\*\-\+] (.+)$/gm, "<li>$1</li>");
						html = html.replace(/^\d+[\.\)] (.+)$/gm, "<li>$1</li>");
						html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (match) => {
							return `<ul>${match}</ul>`;
						});
						const lines = html.split("\n");
						const result = [];
						let paragraphLines = [];
						const isBlockElement = (line) => {
							const trimmed = line.trim();
							return !trimmed || trimmed.startsWith("<h") || trimmed.startsWith("<pre") || trimmed.startsWith("<blockquote") || trimmed.startsWith("<ul") || trimmed.startsWith("<ol") || trimmed.startsWith("<hr") || trimmed.startsWith("<div") || trimmed.startsWith("<li") || trimmed.startsWith("<img") || trimmed.startsWith("</ul") || trimmed.startsWith("</ol");
						};
						const flushParagraph = () => {
							if (paragraphLines.length > 0) {
								result.push(`<p>${paragraphLines.join("<br />")}</p>`);
								paragraphLines = [];
							}
						};
						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed) {
								flushParagraph();
								continue;
							}
							if (isBlockElement(line)) {
								flushParagraph();
								result.push(trimmed);
							} else paragraphLines.push(trimmed);
						}
						flushParagraph();
						return result.join("\n");
					}
					try {
						console.log("[COSE] Twitter Articles 开始填充内容...");
						const htmlContent = parseMarkdownToHtml(markdown);
						console.log("[COSE] Markdown 已转换为 HTML");
						const titleInput = await waitForElement("textarea[placeholder=\"Add a title\"], textarea[name=\"Article Title\"]", 5e3);
						if (titleInput && title) {
							titleInput.focus();
							Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(titleInput, title);
							titleInput.dispatchEvent(new Event("input", { bubbles: true }));
							titleInput.dispatchEvent(new Event("change", { bubbles: true }));
							console.log("[COSE] Twitter Articles 标题填充成功");
						} else console.log("[COSE] Twitter Articles 未找到标题输入框");
						await sleep(500);
						const contentEl = await waitForElement(".public-DraftEditor-content[contenteditable=\"true\"], .DraftEditor-root [contenteditable=\"true\"]", 5e3);
						if (contentEl && htmlContent) {
							contentEl.focus();
							const dt = new DataTransfer();
							dt.setData("text/html", htmlContent);
							dt.setData("text/plain", htmlContent.replace(/<[^>]*>/g, ""));
							const pasteEvent = new ClipboardEvent("paste", {
								bubbles: true,
								cancelable: true,
								clipboardData: dt
							});
							contentEl.dispatchEvent(pasteEvent);
							console.log("[COSE] Twitter Articles 内容填充成功");
							return {
								success: true,
								method: "paste-html",
								length: htmlContent.length
							};
						} else {
							console.log("[COSE] Twitter Articles 未找到内容编辑器");
							return {
								success: false,
								error: "Content editor not found"
							};
						}
					} catch (e) {
						console.error("[COSE] Twitter Articles 同步失败:", e);
						return {
							success: false,
							error: e.message
						};
					}
				},
				args: [content.title, markdownContent],
				world: "MAIN"
			});
			console.log("[COSE] Twitter Articles 填充结果:", fillResult[0]?.result);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			return {
				success: true,
				message: "已同步到 Twitter Articles",
				tabId: tab.id
			};
		}
		if (platformId === "qianfan") {
			const QIANFAN_BLOCK_RULE_ID = 9999;
			try {
				await chrome.declarativeNetRequest.updateDynamicRules({
					removeRuleIds: [QIANFAN_BLOCK_RULE_ID],
					addRules: [{
						id: QIANFAN_BLOCK_RULE_ID,
						priority: 1e3,
						action: { type: "block" },
						condition: {
							urlFilter: "*login.bce.baidu.com*",
							initiatorDomains: ["qianfan.cloud.baidu.com"],
							resourceTypes: ["main_frame", "sub_frame"]
						}
					}]
				});
				console.log("[COSE] 千帆登录页阻止规则已添加");
			} catch (e) {
				console.warn("[COSE] 千帆登录页阻止规则添加失败:", e);
			}
			tab = await chrome.tabs.create({
				url: platform.publishUrl,
				active: false
			});
			await addTabToSyncGroup(tab.id, tab.windowId);
			try {
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					func: qianfanIntercept,
					world: "MAIN",
					injectImmediately: true
				});
				console.log("[COSE] 千帆拦截脚本已动态注入");
			} catch (e) {
				console.warn("[COSE] 千帆拦截脚本注入失败:", e);
			}
			const tabUpdateListener = (tabId, changeInfo) => {
				if (tabId === tab.id && changeInfo.url && changeInfo.url.includes("login.bce.baidu.com")) {
					console.log("[COSE] 检测到千帆 tab 跳转到登录页，导航回编辑器");
					chrome.tabs.update(tabId, { url: platform.publishUrl });
				}
			};
			chrome.tabs.onUpdated.addListener(tabUpdateListener);
			try {
				await waitForTab(tab.id);
				await new Promise((resolve) => setTimeout(resolve, 2e3));
				if (images.prepare) content = await images.prepare(tab);
				const markdownContent = content.markdown ?? content.body ?? "";
				console.log("[COSE] 百度千帆 Markdown 内容长度:", markdownContent?.length || 0);
				const fillResult = await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					func: async (title, markdown) => {
						const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
						const waitForElement = (selector, timeout = 5e3) => {
							return new Promise((resolve) => {
								const el = document.querySelector(selector);
								if (el) return resolve(el);
								const observer = new MutationObserver(() => {
									const el = document.querySelector(selector);
									if (el) {
										observer.disconnect();
										resolve(el);
									}
								});
								observer.observe(document.body, {
									childList: true,
									subtree: true
								});
								setTimeout(() => {
									observer.disconnect();
									resolve(null);
								}, timeout);
							});
						};
						try {
							const titleInput = await waitForElement("textarea[placeholder=\"请输入文章标题\"]");
							if (titleInput && title) {
								titleInput.focus();
								Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(titleInput, title);
								titleInput.dispatchEvent(new Event("input", { bubbles: true }));
								console.log("[COSE] 百度千帆标题填充成功");
							}
							await sleep(300);
							const contentEditor = await waitForElement(".mp-editor-container[contenteditable=\"true\"]");
							if (contentEditor && markdown) {
								contentEditor.focus();
								await sleep(100);
								const dt = new DataTransfer();
								dt.setData("text/plain", markdown);
								const pasteEvent = new ClipboardEvent("paste", {
									bubbles: true,
									cancelable: true,
									clipboardData: dt
								});
								contentEditor.dispatchEvent(pasteEvent);
								console.log("[COSE] 百度千帆内容填充成功");
								let confirmed = false;
								for (let i = 0; i < 15; i++) {
									await sleep(200);
									if (document.body.innerText.includes("检测到 Markdown")) {
										const confirmBtn = document.querySelector(".mp-modal-enter-btn");
										if (confirmBtn) {
											confirmBtn.click();
											confirmed = true;
											console.log("[COSE] 百度千帆已确认 Markdown 转换");
											break;
										}
									}
								}
								await sleep(1e3);
								return {
									success: true,
									confirmed
								};
							}
							return {
								success: false,
								error: "Editor not found"
							};
						} catch (e) {
							console.error("[COSE] 百度千帆同步失败:", e);
							return {
								success: false,
								error: e.message
							};
						}
					},
					args: [content.title, markdownContent],
					world: "MAIN"
				});
				console.log("[COSE] 百度千帆填充结果:", fillResult[0]?.result);
				await new Promise((resolve) => setTimeout(resolve, 2e3));
				chrome.tabs.onUpdated.removeListener(tabUpdateListener);
				try {
					await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [QIANFAN_BLOCK_RULE_ID] });
					console.log("[COSE] 千帆登录页阻止规则已移除");
				} catch (_) {}
				return {
					success: true,
					message: "已同步到百度云千帆，请手动点击发布",
					tabId: tab.id
				};
			} catch (e) {
				console.error("[COSE] 千帆同步失败:", e);
				chrome.tabs.onUpdated.removeListener(tabUpdateListener);
				try {
					await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [QIANFAN_BLOCK_RULE_ID] });
				} catch (_) {}
				return {
					success: false,
					message: "千帆同步失败: " + e.message
				};
			}
		}
		if (platformId !== "wechat" && !tab) {
			let targetUrl = platform.publishUrl;
			if (platformId === "oschina") {
				const userId = (await chrome.storage.local.get("oschina_userId"))?.oschina_userId;
				if (userId) {
					targetUrl = `https://my.oschina.net/u/${userId}/blog/ai-write`;
					console.log("[COSE] 使用 OSChina AI 写作 URL:", targetUrl);
				} else console.warn("[COSE] 未找到 OSChina 用户 ID，使用默认 URL");
			}
			tab = await retryTabEdit(() => chrome.tabs.create({
				url: targetUrl,
				active: false
			}));
			await addTabToSyncGroup(tab.id, tab.windowId);
			await waitForTab(tab.id);
		}
		if (images.prepare) content = await images.prepare(tab);
		if (platformId === "wechat") {
			const htmlContent = content.wechatHtml || content.body;
			console.log("[COSE] 微信 HTML 内容长度:", htmlContent?.length || 0);
			await new Promise((resolve) => setTimeout(resolve, 2e3));
			console.log("[COSE] 开始注入微信内容...");
			console.log("[COSE] 目标 tab ID:", tab.id);
			let result;
			try {
				result = await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					func: async (title, htmlBody) => {
						const waitForElement = (selector, timeout = 15e3) => {
							return new Promise((resolve) => {
								const el = document.querySelector(selector);
								if (el) return resolve(el);
								const observer = new MutationObserver(() => {
									const el = document.querySelector(selector);
									if (el) {
										observer.disconnect();
										resolve(el);
									}
								});
								observer.observe(document.body, {
									childList: true,
									subtree: true
								});
								setTimeout(() => {
									observer.disconnect();
									resolve(document.querySelector(selector));
								}, timeout);
							});
						};
						try {
							const editor = await waitForElement(".ProseMirror");
							if (!editor) return {
								success: false,
								error: "未找到编辑器"
							};
							const titleInput = await waitForElement("#title");
							if (titleInput && title) {
								titleInput.focus();
								const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
								if (nativeSetter) nativeSetter.call(titleInput, title);
								else titleInput.value = title;
								titleInput.dispatchEvent(new Event("input", { bubbles: true }));
								titleInput.dispatchEvent(new Event("change", { bubbles: true }));
								console.log("[COSE] 微信标题已填充:", title);
							}
							await new Promise((r) => setTimeout(r, 300));
							if (editor && htmlBody) {
								editor.focus();
								if (editor.textContent.includes("从这里开始写正文")) editor.innerHTML = "";
								const dt = new DataTransfer();
								dt.setData("text/html", htmlBody);
								dt.setData("text/plain", htmlBody.replace(/<[^>]*>/g, ""));
								const pasteEvent = new ClipboardEvent("paste", {
									bubbles: true,
									cancelable: true,
									clipboardData: dt
								});
								editor.dispatchEvent(pasteEvent);
								console.log("[COSE] 微信内容已通过 paste 事件注入");
								await new Promise((r) => setTimeout(r, 500));
								if ((editor.textContent?.length || 0) === 0) {
									console.log("[COSE] paste 事件未生效，尝试备用方案");
									editor.innerHTML = htmlBody;
									editor.dispatchEvent(new Event("input", { bubbles: true }));
								}
								return {
									success: true,
									wordCount: editor.textContent?.length || 0,
									titleFilled: titleInput?.value === title
								};
							}
							return {
								success: false,
								error: "内容为空"
							};
						} catch (err) {
							return {
								success: false,
								error: err.message
							};
						}
					},
					args: [content.title, htmlContent],
					world: "MAIN"
				});
			} catch (e) {
				console.error("[COSE] executeScript 执行失败:", e);
				return {
					success: false,
					message: "脚本执行失败: " + e.message,
					tabId: tab.id
				};
			}
			console.log("[COSE] executeScript 返回数组长度:", result?.length);
			console.log("[COSE] executeScript 完整返回:", JSON.stringify(result, null, 2));
			if (!result || result.length === 0) {
				console.error("[COSE] executeScript 返回空数组");
				return {
					success: false,
					message: "脚本执行失败：无返回值",
					tabId: tab.id
				};
			}
			const fillResult = result[0].result;
			console.log("[COSE] 微信填充结果:", JSON.stringify(fillResult, null, 2));
			if (!result || !result[0]) {
				console.error("[COSE] executeScript 没有返回有效结果");
				return {
					success: false,
					message: "内容注入失败：脚本执行无返回值",
					tabId: tab.id
				};
			}
			if (!fillResult?.success) {
				console.error("[COSE] 微信内容填充失败:", fillResult?.error);
				console.error("[COSE] 完整 result 对象:", result);
				return {
					success: false,
					message: fillResult?.error || "内容填充失败",
					tabId: tab.id
				};
			}
			console.log("[COSE] 微信内容填充成功，字数:", fillResult.wordCount);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: () => {
					const saveDraftBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("保存为草稿"));
					if (saveDraftBtn) {
						saveDraftBtn.click();
						console.log("[COSE] 已点击保存为草稿");
					}
				},
				world: "MAIN"
			});
			return {
				success: true,
				message: "已同步并保存为草稿",
				tabId: tab.id
			};
		}
		if (platformId === "douyin") {
			const htmlContent = content.wechatHtml || content.body;
			console.log("[COSE] 抖音 HTML 内容长度:", htmlContent?.length || 0);
			console.log("[COSE] 开始注入抖音内容...");
			let result;
			try {
				result = await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					func: async (title, htmlBody) => {
						const waitForElement = (selector, timeout = 1e4) => {
							return new Promise((resolve) => {
								const el = document.querySelector(selector);
								if (el) return resolve(el);
								const observer = new MutationObserver(() => {
									const el = document.querySelector(selector);
									if (el) {
										observer.disconnect();
										resolve(el);
									}
								});
								observer.observe(document.body, {
									childList: true,
									subtree: true
								});
								setTimeout(() => {
									observer.disconnect();
									resolve(document.querySelector(selector));
								}, timeout);
							});
						};
						try {
							const editor = await waitForElement("[contenteditable=\"true\"]");
							if (!editor) return {
								success: false,
								error: "未找到编辑器"
							};
							const titleInput = await waitForElement("input[placeholder*=\"标题\"]");
							if (titleInput && title) {
								titleInput.focus();
								const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
								if (nativeSetter) nativeSetter.call(titleInput, title);
								else titleInput.value = title;
								titleInput.dispatchEvent(new Event("input", { bubbles: true }));
								titleInput.dispatchEvent(new Event("change", { bubbles: true }));
								console.log("[COSE] 抖音标题已填充:", title);
							}
							if (editor && htmlBody) {
								editor.focus();
								editor.innerHTML = "";
								const dt = new DataTransfer();
								dt.setData("text/html", htmlBody);
								dt.setData("text/plain", htmlBody.replace(/<[^>]*>/g, ""));
								const pasteEvent = new ClipboardEvent("paste", {
									bubbles: true,
									cancelable: true,
									clipboardData: dt
								});
								editor.dispatchEvent(pasteEvent);
								console.log("[COSE] 抖音内容已通过 paste 事件注入");
								if ((editor.textContent?.length || 0) === 0) {
									console.log("[COSE] paste 事件未生效，尝试备用方案");
									editor.innerHTML = htmlBody;
									editor.dispatchEvent(new Event("input", { bubbles: true }));
								}
								return {
									success: true,
									wordCount: editor.textContent?.length || 0,
									titleFilled: titleInput?.value === title
								};
							}
							return {
								success: false,
								error: "内容为空"
							};
						} catch (err) {
							return {
								success: false,
								error: err.message
							};
						}
					},
					args: [content.title, htmlContent],
					world: "MAIN"
				});
			} catch (e) {
				console.error("[COSE] executeScript 执行失败:", e);
				return {
					success: false,
					message: "脚本执行失败: " + e.message,
					tabId: tab.id
				};
			}
			console.log("[COSE] 抖音填充结果:", JSON.stringify(result, null, 2));
			if (!result || result.length === 0) return {
				success: false,
				message: "脚本执行失败：无返回值",
				tabId: tab.id
			};
			const fillResult = result[0].result;
			if (!fillResult?.success) return {
				success: false,
				message: fillResult?.error || "内容填充失败",
				tabId: tab.id
			};
			console.log("[COSE] 抖音内容填充成功，字数:", fillResult.wordCount);
			return {
				success: true,
				message: "已同步到抖音",
				tabId: tab.id
			};
		}
		if (platformId === "sohu") {
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const htmlContent = content.wechatHtml || content.body;
			console.log("[COSE] 搜狐号 HTML 内容长度:", htmlContent?.length || 0);
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: (title, htmlBody) => {
					const titleInput = document.querySelector("input[placeholder*=\"标题\"]");
					if (titleInput && title) {
						titleInput.focus();
						Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(titleInput, title);
						titleInput.dispatchEvent(new Event("input", { bubbles: true }));
						titleInput.dispatchEvent(new Event("change", { bubbles: true }));
						console.log("[COSE] 搜狐号标题填充成功");
					}
					const editor = document.querySelector(".ql-editor");
					if (editor && htmlBody) {
						editor.focus();
						editor.innerHTML = "";
						const dt = new DataTransfer();
						dt.setData("text/html", htmlBody);
						dt.setData("text/plain", htmlBody.replace(/<[^>]*>/g, ""));
						const pasteEvent = new ClipboardEvent("paste", {
							bubbles: true,
							cancelable: true,
							clipboardData: dt
						});
						editor.dispatchEvent(pasteEvent);
						console.log("[COSE] 搜狐号内容已通过 paste 事件注入");
					} else console.log("[COSE] 搜狐号未找到编辑器");
				},
				args: [content.title, htmlContent],
				world: "MAIN"
			});
			await new Promise((resolve) => setTimeout(resolve, 2e3));
			return {
				success: true,
				message: "已同步到搜狐号",
				tabId: tab.id
			};
		}
		if (platformId === "weibo") {
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const htmlContent = content.wechatHtml || content.body;
			console.log("[COSE] 微博头条 HTML 内容长度:", htmlContent?.length || 0);
			const fillResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: (title, htmlBody) => {
					const titleInput = document.querySelector("textarea[placeholder*=\"标题\"]");
					if (titleInput && title) {
						titleInput.focus();
						titleInput.value = title;
						titleInput.dispatchEvent(new Event("input", { bubbles: true }));
						titleInput.dispatchEvent(new Event("change", { bubbles: true }));
						console.log("[COSE] 微博头条标题填充成功");
					}
					const editor = document.querySelector(".ProseMirror");
					if (editor && htmlBody) {
						editor.innerHTML = htmlBody;
						editor.dispatchEvent(new Event("input", { bubbles: true }));
						console.log("[COSE] 微博头条内容填充成功");
						return { success: true };
					}
					return {
						success: false,
						error: "Editor not found"
					};
				},
				args: [content.title, htmlContent],
				world: "MAIN"
			});
			console.log("[COSE] 微博头条填充结果:", fillResult);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			await images.cover?.(tab);
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: () => {
					const saveBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent && b.textContent.includes("保存草稿"));
					if (saveBtn) {
						saveBtn.click();
						console.log("[COSE] 微博头条已点击保存草稿");
					}
				},
				world: "MAIN"
			});
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			return {
				success: true,
				message: "已同步到微博头条",
				tabId: tab.id
			};
		}
		if (platformId === "aliyun") {
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const markdownContent = content.markdown ?? content.body ?? "";
			console.log("[COSE] 阿里云开发者社区 Markdown 内容长度:", markdownContent?.length || 0);
			const fillResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: (title, markdown) => {
					const titleInput = document.querySelector("input[placeholder*=\"标题\"]");
					if (titleInput && title) {
						titleInput.focus();
						Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(titleInput, title);
						titleInput.dispatchEvent(new Event("input", { bubbles: true }));
						titleInput.dispatchEvent(new Event("change", { bubbles: true }));
						console.log("[COSE] 阿里云开发者社区标题填充成功");
					}
					const contentTextarea = document.querySelector("textarea[class*=\"editor\"]") || document.querySelector(".markdown-editor textarea") || document.querySelector("textarea:not([placeholder*=\"标题\"])");
					if (contentTextarea && markdown) {
						contentTextarea.focus();
						Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(contentTextarea, markdown);
						contentTextarea.dispatchEvent(new Event("input", { bubbles: true }));
						contentTextarea.dispatchEvent(new Event("change", { bubbles: true }));
						console.log("[COSE] 阿里云开发者社区内容填充成功");
						return { success: true };
					}
					return {
						success: false,
						error: "Editor not found"
					};
				},
				args: [content.title, markdownContent],
				world: "MAIN"
			});
			console.log("[COSE] 阿里云开发者社区填充结果:", fillResult);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			return {
				success: true,
				message: "已同步到阿里云开发者社区",
				tabId: tab.id
			};
		}
		if (platformId === "volcengine") {
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const markdownContent = content.markdown ?? content.body ?? "";
			console.log("[COSE] 火山引擎开发者社区 Markdown 内容长度:", markdownContent?.length || 0);
			const fillResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: (title, markdown) => {
					const titleInput = document.querySelector("input[placeholder*=\"标题\"]") || document.querySelector("input[class*=\"title\"]") || document.querySelector(".article-title input");
					if (titleInput && title) {
						titleInput.focus();
						Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(titleInput, title);
						titleInput.dispatchEvent(new Event("input", { bubbles: true }));
						titleInput.dispatchEvent(new Event("change", { bubbles: true }));
						console.log("[COSE] 火山引擎开发者社区标题填充成功");
					}
					const codeMirrorEl = document.querySelector(".CodeMirror");
					if (codeMirrorEl && codeMirrorEl.CodeMirror && markdown) {
						codeMirrorEl.CodeMirror.setValue(markdown);
						console.log("[COSE] 火山引擎开发者社区内容填充成功");
						return {
							success: true,
							method: "CodeMirror"
						};
					}
					const contentTextarea = document.querySelector(".bytemd-editor textarea") || document.querySelector("textarea:not([placeholder*=\"标题\"])");
					if (contentTextarea && markdown) {
						contentTextarea.focus();
						Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(contentTextarea, markdown);
						contentTextarea.dispatchEvent(new Event("input", { bubbles: true }));
						contentTextarea.dispatchEvent(new Event("change", { bubbles: true }));
						console.log("[COSE] 火山引擎开发者社区内容填充成功（textarea）");
						return {
							success: true,
							method: "textarea"
						};
					}
					return {
						success: false,
						error: "Editor not found"
					};
				},
				args: [content.title, markdownContent],
				world: "MAIN"
			});
			console.log("[COSE] 火山引擎开发者社区填充结果:", fillResult);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			return {
				success: true,
				message: "已同步到火山引擎开发者社区",
				tabId: tab.id
			};
		}
		if (platformId === "huaweicloud") {
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const markdownContent = content.markdown ?? content.body ?? "";
			console.log("[COSE] 华为云开发者博客 Markdown 内容长度:", markdownContent?.length || 0);
			if ((await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: () => {
					if (window.tinymceModal?.currentEditorType === "markdown") {
						console.log("[COSE] 华为云已经是 Markdown 编辑器");
						return { alreadyMarkdown: true };
					}
					const allElements = document.querySelectorAll("*");
					for (const el of allElements) if (el.textContent === "Markdown格式编辑" && el.children.length === 0) {
						el.click();
						console.log("[COSE] 华为云已点击 Markdown 编辑器标签");
						return { clicked: true };
					}
					return { clicked: false };
				},
				world: "MAIN"
			}))[0]?.result?.clicked) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					func: () => {
						const allElements = document.querySelectorAll("*");
						for (const el of allElements) if (el.textContent === "确定" && el.children.length === 0) {
							el.click();
							console.log("[COSE] 华为云已点击确定按钮");
							return { confirmed: true };
						}
						return { confirmed: false };
					},
					world: "MAIN"
				});
				await new Promise((resolve) => setTimeout(resolve, 3e3));
			}
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: (title) => {
					const titleInput = document.querySelector("input[placeholder*=\"标题\"]");
					if (titleInput && title) {
						titleInput.focus();
						titleInput.value = title;
						titleInput.dispatchEvent(new Event("input", { bubbles: true }));
						titleInput.dispatchEvent(new Event("change", { bubbles: true }));
						console.log("[COSE] 华为云开发者博客标题填充成功");
					}
				},
				args: [content.title],
				world: "MAIN"
			});
			const fillResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: async (markdown) => {
					const waitForEditorReady = (timeout = 15e3) => {
						return new Promise((resolve) => {
							const check = () => {
								const editor = window.tinymceModal?.currentEditor;
								if (editor && typeof editor.setContent === "function") {
									const iframe = document.getElementById(editor.editor_id);
									if (iframe && iframe.contentWindow) return {
										editor,
										iframe
									};
								}
								return null;
							};
							const immediate = check();
							if (immediate) return resolve(immediate);
							let resolved = false;
							const observer = new MutationObserver(() => {
								if (resolved) return;
								const result = check();
								if (result) {
									resolved = true;
									observer.disconnect();
									resolve(result);
								}
							});
							observer.observe(document.body, {
								childList: true,
								subtree: true
							});
							setTimeout(() => {
								if (!resolved) {
									resolved = true;
									observer.disconnect();
									resolve(null);
								}
							}, timeout);
						});
					};
					const setContentWithConfirm = (editor, iframe, content, timeout = 3e3) => {
						return new Promise((resolve) => {
							let resolved = false;
							const onMessage = (event) => {
								try {
									const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
									if (data.mdEventAction === "setMdDataSucc" || data.mdEventAction === "mdContent") {
										if (!resolved) {
											resolved = true;
											window.removeEventListener("message", onMessage);
											resolve({ confirmed: true });
										}
									}
								} catch (e) {}
							};
							window.addEventListener("message", onMessage);
							editor.setContent(content);
							setTimeout(() => {
								if (!resolved) {
									resolved = true;
									window.removeEventListener("message", onMessage);
									resolve({ confirmed: false });
								}
							}, timeout);
						});
					};
					console.log("[COSE] 华为云：等待 Markdown 编辑器 iframe 就绪...");
					const ready = await waitForEditorReady();
					if (!ready) {
						console.log("[COSE] 华为云：编辑器等待超时");
						return {
							success: false,
							error: "编辑器 iframe 等待超时"
						};
					}
					console.log("[COSE] 华为云：编辑器 iframe 已就绪");
					const maxRetries = 6;
					for (let attempt = 1; attempt <= maxRetries; attempt++) {
						console.log(`[COSE] 华为云内容填充尝试 ${attempt}/${maxRetries}`);
						if ((await setContentWithConfirm(ready.editor, ready.iframe, markdown)).confirmed) {
							console.log(`[COSE] 华为云内容填充成功（第${attempt}次），已收到 iframe 确认`);
							return {
								success: true,
								method: "message-confirm",
								attempt,
								length: markdown.length
							};
						}
						console.log(`[COSE] 华为云：未收到 iframe 确认，等待后重试...`);
						await new Promise((r) => setTimeout(r, 2e3));
					}
					console.log("[COSE] 重试耗尽，尝试直接 postMessage");
					ready.iframe.contentWindow.postMessage(JSON.stringify({
						mdEditorEventAction: "setMdEditorContent",
						data: encodeURIComponent(markdown)
					}), "*");
					await new Promise((r) => setTimeout(r, 1e3));
					return {
						success: true,
						method: "direct-postMessage",
						length: markdown.length
					};
				},
				args: [markdownContent],
				world: "MAIN"
			});
			console.log("[COSE] 华为云开发者博客填充结果:", fillResult);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			await images.cover?.(tab);
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: () => {
					const allLinks = document.querySelectorAll("a");
					for (const link of allLinks) if (link.textContent && link.textContent.includes("保存草稿")) {
						link.click();
						console.log("[COSE] 华为云开发者博客已点击保存草稿");
						return { clicked: true };
					}
					return { clicked: false };
				},
				world: "MAIN"
			});
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			return {
				success: true,
				message: "已同步到华为云开发者博客",
				tabId: tab.id
			};
		}
		if (platformId === "huaweidev") {
			const markdownContent = content.markdown ?? content.body ?? "";
			console.log("[COSE] 华为开发者文章 Markdown 内容长度:", markdownContent?.length || 0);
			const result = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: async (title, markdown) => {
					const handleDialog = () => {
						const modalBtns = document.querySelector(".ant-modal-confirm-btns");
						if (modalBtns) {
							const buttons = modalBtns.querySelectorAll("button");
							const modalText = document.querySelector(".ant-modal-confirm-content")?.textContent || "";
							console.log("[COSE] 检测到 Ant Modal:", modalText.substring(0, 50));
							if (modalText.includes("温馨提示") || modalText.includes("未保存")) {
								for (const btn of buttons) if (btn.textContent?.trim() === "取消") {
									console.log("[COSE] 点击温馨提示弹窗的取消按钮");
									btn.click();
									return true;
								}
							}
							if (modalText.includes("Markdown") || modalText.includes("切换")) {
								for (const btn of buttons) if (btn.textContent?.trim() === "确认") {
									console.log("[COSE] 点击 MD 切换确认按钮");
									btn.click();
									return true;
								}
							}
						}
						const dialog = document.querySelector("dialog[open]");
						if (dialog) {
							const dialogText = dialog.textContent || "";
							const buttons = dialog.querySelectorAll("button");
							console.log("[COSE] 检测到 dialog:", dialogText.substring(0, 50));
							if (dialogText.includes("温馨提示") || dialogText.includes("未保存")) {
								for (const btn of buttons) if (btn.textContent?.trim() === "取消") {
									btn.click();
									return true;
								}
							}
							if (dialogText.includes("Markdown") || dialogText.includes("切换")) {
								for (const btn of buttons) if (btn.textContent?.trim() === "确认") {
									btn.click();
									return true;
								}
							}
						}
						return false;
					};
					const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
					let dialogCheckInterval = null;
					const startDialogChecker = () => {
						handleDialog();
						dialogCheckInterval = setInterval(() => {
							handleDialog();
						}, 200);
						console.log("[COSE] 华为开发者文章弹窗检查器已启动");
					};
					const stopDialogChecker = () => {
						if (dialogCheckInterval) {
							clearInterval(dialogCheckInterval);
							dialogCheckInterval = null;
							console.log("[COSE] 华为开发者文章弹窗检查器已停止");
						}
					};
					const waitForElement = async (selector, timeout = 5e3) => {
						const start = Date.now();
						while (Date.now() - start < timeout) {
							const el = document.querySelector(selector);
							if (el) return el;
							await sleep(100);
						}
						return null;
					};
					const waitForMdButton = async (timeout = 15e3) => {
						const start = Date.now();
						while (Date.now() - start < timeout) {
							let btn = document.querySelector("a.cke_button__cktomd");
							if (btn) return btn;
							const allLinks = document.querySelectorAll("a");
							for (const link of allLinks) if (link.textContent?.trim() === "MD编辑器") return link;
							const allButtons = document.querySelectorAll("button");
							for (const b of allButtons) if (b.textContent?.trim() === "MD编辑器") return b;
							await sleep(300);
						}
						return null;
					};
					const waitForRichTextButton = async (timeout = 2e3) => {
						const start = Date.now();
						while (Date.now() - start < timeout) {
							const allElements = document.querySelectorAll("a, button");
							for (const el of allElements) if (el.textContent?.trim() === "富文本编辑器") return el;
							await sleep(200);
						}
						return null;
					};
					try {
						startDialogChecker();
						if (document.readyState !== "complete") {
							console.log("[COSE] 等待 DOM 加载完成...");
							await new Promise((resolve) => {
								if (document.readyState === "complete") resolve();
								else window.addEventListener("load", resolve, { once: true });
							});
						}
						console.log("[COSE] 等待编辑器工具栏加载...");
						let mdButton = await waitForMdButton(15e3);
						let richTextButton = await waitForRichTextButton(2e3);
						let aceEditor = document.querySelector(".ace_editor");
						if (richTextButton || aceEditor) {
							console.log("[COSE] 已经是 Markdown 编辑器");
							aceEditor = aceEditor || document.querySelector(".ace_editor");
						} else if (!aceEditor) {
							if (mdButton) {
								console.log("[COSE] 点击 MD编辑器 按钮");
								mdButton.click();
								aceEditor = await waitForElement(".ace_editor", 1e4);
								if (!aceEditor) {
									console.error("[COSE] 等待 ACE Editor 超时");
									return {
										success: false,
										error: "ACE Editor not found after timeout"
									};
								}
							} else {
								console.error("[COSE] 未找到 MD编辑器 按钮");
								return {
									success: false,
									error: "MD Editor button not found"
								};
							}
						}
						console.log("[COSE] 华为开发者文章已进入 Markdown 编辑器");
						await sleep(500);
						const titleInput = document.querySelector("input[placeholder*=\"标题\"]");
						if (titleInput && title) {
							titleInput.focus();
							Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(titleInput, title);
							titleInput.dispatchEvent(new Event("input", { bubbles: true }));
							titleInput.dispatchEvent(new Event("change", { bubbles: true }));
							console.log("[COSE] 华为开发者文章标题填充成功");
						}
						if (typeof ace !== "undefined") {
							const editor = ace.edit(aceEditor);
							if (editor) {
								editor.session.setValue(markdown);
								console.log("[COSE] 华为开发者文章内容填充成功，长度:", markdown.length);
							}
						}
						return {
							success: true,
							method: "ace",
							length: markdown.length
						};
					} finally {
						stopDialogChecker();
					}
				},
				args: [content.title, markdownContent],
				world: "MAIN"
			});
			console.log("[COSE] 华为开发者文章填充结果:", result[0]?.result);
			return {
				success: true,
				message: "已同步到华为开发者文章",
				tabId: tab.id
			};
		}
		if (platformId === "baijiahao") {
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const htmlContent = content.wechatHtml || content.body;
			console.log("[COSE] 百家号 HTML 内容长度:", htmlContent?.length || 0);
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: (title, htmlBody) => {
					const titleEditor = document.querySelector(".client_components_titleInput [contenteditable=\"true\"]") || document.querySelector(".client_pages_edit_components_titleInput [contenteditable=\"true\"]") || document.querySelector("[class*=\"titleInput\"] [contenteditable=\"true\"]");
					if (titleEditor && title) {
						titleEditor.focus();
						titleEditor.innerHTML = "";
						document.execCommand("insertText", false, title);
						if (!titleEditor.textContent) titleEditor.innerHTML = `<p dir="auto">${title}</p>`;
						titleEditor.dispatchEvent(new Event("input", { bubbles: true }));
						console.log("[COSE] 百家号标题已填充");
					}
					setTimeout(() => {
						if (window.UE_V2 && window.UE_V2.instants && window.UE_V2.instants.ueditorInstant0) try {
							const editor = window.UE_V2.instants.ueditorInstant0;
							const tempDiv = document.createElement("div");
							tempDiv.innerHTML = htmlBody;
							const originalFormulas = [];
							tempDiv.querySelectorAll(".katex-inline, .katex-block, section.katex-block").forEach((formula, index) => {
								const svg = formula.querySelector("svg");
								if (svg && svg.innerHTML) originalFormulas.push({
									index,
									className: formula.className,
									fullHtml: formula.outerHTML
								});
							});
							console.log("[COSE] 百家号提取到", originalFormulas.length, "个公式");
							editor.setContent(htmlBody);
							if (originalFormulas.length > 0) setTimeout(() => {
								const iframe = document.querySelector("iframe");
								if (iframe && iframe.contentDocument) {
									iframe.contentDocument.querySelectorAll(".katex-inline, .katex-block, section.katex-block").forEach((emptyFormula, index) => {
										const original = originalFormulas[index];
										if (original) {
											const newElement = document.createElement("div");
											newElement.innerHTML = original.fullHtml;
											const newFormula = newElement.firstElementChild;
											if (newFormula && emptyFormula.parentNode) emptyFormula.parentNode.replaceChild(newFormula, emptyFormula);
										}
									});
									console.log("[COSE] 百家号公式 SVG 已恢复");
									editor.fireEvent("contentChange");
								}
							}, 300);
							editor.fireEvent("contentChange");
							editor.fireEvent("selectionchange");
							console.log("[COSE] 百家号通过 UEditor API 填充成功");
							return;
						} catch (e) {
							console.log("[COSE] 百家号 UEditor API 调用失败", e);
						}
					}, 500);
				},
				args: [content.title, htmlContent],
				world: "MAIN"
			});
			await new Promise((resolve) => setTimeout(resolve, 2e3));
			return {
				success: true,
				message: "已同步到百家号",
				tabId: tab.id
			};
		}
		if (platformId === "sspai") {
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const htmlContent = content.wechatHtml || content.body;
			console.log("[COSE] 少数派 HTML 内容长度:", htmlContent?.length || 0);
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: (title, htmlBody) => {
					const titleInput = document.querySelector("textarea[placeholder*=\"标题\"]") || document.querySelector("input[placeholder*=\"标题\"]");
					if (titleInput && title) {
						titleInput.focus();
						(Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set).call(titleInput, title);
						titleInput.dispatchEvent(new InputEvent("input", {
							bubbles: true,
							data: title,
							inputType: "insertText"
						}));
						titleInput.dispatchEvent(new Event("change", { bubbles: true }));
						titleInput.dispatchEvent(new Event("blur", { bubbles: true }));
						console.log("[COSE] 少数派标题已填充");
					}
					setTimeout(() => {
						const editor = document.querySelector(".ProseMirror") || document.querySelector("[contenteditable=\"true\"]");
						if (editor && htmlBody) {
							editor.focus();
							const dt = new DataTransfer();
							dt.setData("text/html", htmlBody);
							dt.setData("text/plain", htmlBody.replace(/<[^>]*>/g, ""));
							const pasteEvent = new ClipboardEvent("paste", {
								bubbles: true,
								cancelable: true,
								clipboardData: dt
							});
							editor.dispatchEvent(pasteEvent);
							console.log("[COSE] 少数派内容已通过 paste 事件注入");
						}
					}, 500);
				},
				args: [content.title, htmlContent],
				world: "MAIN"
			});
			await new Promise((resolve) => setTimeout(resolve, 2e3));
			return {
				success: true,
				message: "已同步到少数派",
				tabId: tab.id
			};
		}
		if (platformId === "alipayopen") {
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const htmlContent = content.wechatHtml || content.body;
			console.log("[COSE] 支付宝开放平台 HTML 内容长度:", htmlContent?.length || 0);
			const fillResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: async (title, htmlBody) => {
					const waitForElement = (selector, timeout = 1e4) => {
						return new Promise((resolve) => {
							const el = document.querySelector(selector);
							if (el) return resolve(el);
							const observer = new MutationObserver(() => {
								const el = document.querySelector(selector);
								if (el) {
									observer.disconnect();
									resolve(el);
								}
							});
							observer.observe(document.body, {
								childList: true,
								subtree: true
							});
							setTimeout(() => {
								observer.disconnect();
								resolve(document.querySelector(selector));
							}, timeout);
						});
					};
					try {
						console.log("[COSE] 支付宝开放平台开始填充内容...");
						const titleInput = await waitForElement("#title", 5e3) || await waitForElement("input[placeholder*=\"标题\"]", 5e3);
						if (titleInput && title) {
							titleInput.focus();
							titleInput.value = "";
							const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
							if (nativeSetter) nativeSetter.call(titleInput, title);
							else titleInput.value = title;
							titleInput.dispatchEvent(new Event("input", { bubbles: true }));
							titleInput.dispatchEvent(new Event("change", { bubbles: true }));
							titleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
							titleInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
							if (titleInput._valueTracker) titleInput._valueTracker.setValue("");
							titleInput.value = title;
							titleInput.dispatchEvent(new Event("input", {
								bubbles: true,
								cancelable: true
							}));
							const inputEvent = new InputEvent("input", {
								bubbles: true,
								cancelable: true,
								data: title,
								inputType: "insertText"
							});
							titleInput.dispatchEvent(inputEvent);
							console.log("[COSE] 支付宝开放平台标题已填充:", title, "当前值:", titleInput.value);
						}
						await new Promise((r) => setTimeout(r, 300));
						const editor = await waitForElement(".ne-engine[contenteditable=\"true\"]", 5e3);
						if (editor && htmlBody) {
							editor.focus();
							editor.innerHTML = "";
							const dt = new DataTransfer();
							dt.setData("text/html", htmlBody);
							dt.setData("text/plain", htmlBody.replace(/<[^>]*>/g, ""));
							const pasteEvent = new ClipboardEvent("paste", {
								bubbles: true,
								cancelable: true,
								clipboardData: dt
							});
							editor.dispatchEvent(pasteEvent);
							console.log("[COSE] 支付宝开放平台内容已通过 paste 事件注入");
							await new Promise((r) => setTimeout(r, 500));
							if ((editor.textContent?.length || 0) === 0) {
								console.log("[COSE] paste 事件未生效，尝试备用方案");
								editor.innerHTML = htmlBody;
								editor.dispatchEvent(new Event("input", { bubbles: true }));
							}
							return {
								success: true,
								method: "paste-html",
								length: htmlBody.length
							};
						}
						return {
							success: false,
							error: "ne-engine editor not found"
						};
					} catch (e) {
						console.error("[COSE] 支付宝开放平台同步失败:", e);
						return {
							success: false,
							error: e.message
						};
					}
				},
				args: [content.title, htmlContent],
				world: "MAIN"
			});
			console.log("[COSE] 支付宝开放平台填充结果:", fillResult[0]?.result);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			return {
				success: true,
				message: "已同步到支付宝开放平台",
				tabId: tab.id
			};
		}
		if (platformId === "elecfans") {
			await new Promise((resolve) => setTimeout(resolve, 3e3));
			const markdownContent = content.markdown ?? content.body ?? "";
			console.log("[COSE] 电子发烧友 Markdown 内容长度:", markdownContent?.length || 0);
			const fillResult = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: async (title, markdown) => {
					const waitForElement = (selector, timeout = 1e4) => {
						return new Promise((resolve) => {
							const el = document.querySelector(selector);
							if (el) return resolve(el);
							const observer = new MutationObserver(() => {
								const el = document.querySelector(selector);
								if (el) {
									observer.disconnect();
									resolve(el);
								}
							});
							observer.observe(document.body, {
								childList: true,
								subtree: true
							});
							setTimeout(() => {
								observer.disconnect();
								resolve(document.querySelector(selector));
							}, timeout);
						});
					};
					try {
						console.log("[COSE] 电子发烧友开始填充内容...");
						const titleInput = await waitForElement("input[placeholder*=\"标题\"], input.title-input, input[name=\"title\"]", 5e3);
						if (titleInput && title) {
							titleInput.focus();
							const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
							if (nativeSetter) nativeSetter.call(titleInput, title);
							else titleInput.value = title;
							titleInput.dispatchEvent(new Event("input", { bubbles: true }));
							titleInput.dispatchEvent(new Event("change", { bubbles: true }));
							console.log("[COSE] 电子发烧友标题已填充:", title);
						}
						await new Promise((r) => setTimeout(r, 500));
						const vditorWysiwyg = document.querySelector(".vditor-wysiwyg .vditor-reset");
						if (vditorWysiwyg) {
							vditorWysiwyg.focus();
							const dt = new DataTransfer();
							dt.setData("text/plain", markdown);
							const pasteEvent = new ClipboardEvent("paste", {
								bubbles: true,
								cancelable: true,
								clipboardData: dt
							});
							vditorWysiwyg.dispatchEvent(pasteEvent);
							console.log("[COSE] 电子发烧友 Vditor paste 事件已触发");
							await new Promise((r) => setTimeout(r, 500));
							const wordCount = vditorWysiwyg.textContent?.length || 0;
							if (wordCount > 10) {
								console.log("[COSE] 电子发烧友 Vditor 内容已填充，字数:", wordCount);
								return {
									success: true,
									method: "vditor-paste",
									length: wordCount
								};
							}
							console.log("[COSE] paste 事件未生效，尝试直接输入");
							vditorWysiwyg.textContent = markdown;
							vditorWysiwyg.dispatchEvent(new Event("input", { bubbles: true }));
							return {
								success: true,
								method: "vditor-direct",
								length: markdown.length
							};
						}
						const cmElement = document.querySelector(".CodeMirror");
						if (cmElement && cmElement.CodeMirror) {
							cmElement.CodeMirror.setValue(markdown);
							console.log("[COSE] 电子发烧友 CodeMirror 内容已填充");
							return {
								success: true,
								method: "codemirror",
								length: markdown.length
							};
						}
						const textarea = await waitForElement("textarea.content-textarea, textarea[name=\"content\"], textarea", 5e3);
						if (textarea && markdown) {
							textarea.focus();
							const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
							if (nativeSetter) nativeSetter.call(textarea, markdown);
							else textarea.value = markdown;
							textarea.dispatchEvent(new Event("input", { bubbles: true }));
							textarea.dispatchEvent(new Event("change", { bubbles: true }));
							console.log("[COSE] 电子发烧友 textarea 内容已填充");
							return {
								success: true,
								method: "textarea",
								length: markdown.length
							};
						}
						const editor = await waitForElement("[contenteditable=\"true\"]", 5e3);
						if (editor && markdown) {
							editor.focus();
							editor.textContent = markdown;
							editor.dispatchEvent(new Event("input", { bubbles: true }));
							console.log("[COSE] 电子发烧友 contenteditable 内容已填充");
							return {
								success: true,
								method: "contenteditable",
								length: markdown.length
							};
						}
						return {
							success: false,
							error: "editor not found"
						};
					} catch (e) {
						console.error("[COSE] 电子发烧友同步失败:", e);
						return {
							success: false,
							error: e.message
						};
					}
				},
				args: [content.title, markdownContent],
				world: "MAIN"
			});
			console.log("[COSE] 电子发烧友填充结果:", fillResult[0]?.result);
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			return {
				success: true,
				message: "已同步到电子发烧友",
				tabId: tab.id
			};
		}
		if (platformId === "douban") {
			const textContent = content.markdown ?? content.body ?? "";
			console.log("[COSE] 豆瓣文本内容长度:", textContent?.length || 0);
			await new Promise((resolve) => setTimeout(resolve, 2e3));
			const doubanResult = (await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: async (title, text) => {
					try {
						console.log("[COSE] 豆瓣开始填充内容...");
						if (!text) return {
							success: false,
							error: "Empty content"
						};
						const fullText = title ? `${title}\n\n${text}` : text;
						const editable = document.querySelector("div.DRE-inputor.DRE-root[contenteditable=\"true\"]") || document.querySelector("[contenteditable=\"true\"][role=\"textbox\"]");
						if (editable) {
							editable.focus();
							const lexicalEditor = editable.__lexicalEditor;
							if (lexicalEditor?.parseEditorState && lexicalEditor?.setEditorState) try {
								const lines = fullText.split("\n");
								const makeParagraph = (lineText) => ({
									children: lineText ? [{
										detail: 0,
										format: 0,
										mode: "normal",
										style: "",
										text: lineText,
										type: "text",
										version: 1
									}] : [],
									direction: "ltr",
									format: "",
									indent: 0,
									type: "paragraph",
									version: 1,
									textFormat: 0,
									textStyle: ""
								});
								const nextState = { root: {
									children: lines.map(makeParagraph),
									direction: "ltr",
									format: "",
									indent: 0,
									type: "root",
									version: 1
								} };
								const parsedState = lexicalEditor.parseEditorState(JSON.stringify(nextState));
								lexicalEditor.setEditorState(parsedState);
								lexicalEditor.focus();
								const lexicalLength = (editable.textContent || "").trim().length;
								if (lexicalLength > 0) {
									console.log("[COSE] 豆瓣 lexical API 内容已填充，长度:", lexicalLength);
									return {
										success: true,
										length: lexicalLength,
										mode: "lexical-api"
									};
								}
							} catch (e) {
								console.log("[COSE] 豆瓣 lexical API 填充失败，回退 execCommand:", e.message);
							}
							try {
								const selection = window.getSelection();
								const range = document.createRange();
								range.selectNodeContents(editable);
								selection?.removeAllRanges();
								selection?.addRange(range);
							} catch (_) {}
							try {
								document.execCommand("selectAll", false);
							} catch (_) {}
							try {
								document.execCommand("delete", false);
							} catch (_) {}
							let inserted = false;
							try {
								inserted = document.execCommand("insertText", false, fullText);
							} catch (_) {
								inserted = false;
							}
							if (!inserted) {
								editable.textContent = fullText;
								editable.dispatchEvent(new InputEvent("input", {
									bubbles: true,
									inputType: "insertText",
									data: fullText
								}));
							}
							editable.dispatchEvent(new Event("change", { bubbles: true }));
							const actualLength = (editable.textContent || "").trim().length;
							if (actualLength === 0) return {
								success: false,
								error: "Editor accepted no text"
							};
							console.log("[COSE] 豆瓣 contenteditable 内容已填充，长度:", actualLength);
							return {
								success: true,
								length: actualLength,
								mode: "contenteditable"
							};
						}
						const textarea = document.querySelector("textarea[placeholder*=\"此刻你想要分享\"]") || document.querySelector("textarea[placeholder*=\"分享\"]") || document.querySelector("textarea");
						if (textarea) {
							textarea.focus();
							const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
							if (nativeSetter) nativeSetter.call(textarea, fullText);
							else textarea.value = fullText;
							textarea.dispatchEvent(new Event("input", { bubbles: true }));
							textarea.dispatchEvent(new Event("change", { bubbles: true }));
							console.log("[COSE] 豆瓣 textarea 内容已填充，长度:", fullText.length);
							return {
								success: true,
								length: fullText.length,
								mode: "textarea"
							};
						}
						return {
							success: false,
							error: "Editor not found"
						};
					} catch (e) {
						console.error("[COSE] 豆瓣同步失败:", e);
						return {
							success: false,
							error: e.message
						};
					}
				},
				args: [content.title, textContent],
				world: "MAIN"
			}))[0]?.result;
			console.log("[COSE] 豆瓣填充结果:", doubanResult);
			if (!doubanResult?.success) return {
				success: false,
				message: doubanResult?.error || "豆瓣内容填充失败",
				tabId: tab.id
			};
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			return {
				success: true,
				message: "已同步到豆瓣，请手动点击发布",
				tabId: tab.id
			};
		}
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: fillContentOnPage,
			args: [content, platformId],
			world: "MAIN"
		});
		return {
			success: true,
			message: "已打开发布页面并填充内容",
			tabId: tab.id
		};
	} catch (error) {
		return {
			success: false,
			message: error.message
		};
	}
}
function fillContentOnPage(content, platformId) {
	const { title, body, markdown, wechatHtml } = content;
	function waitFor(selector, timeout = 1e4) {
		return new Promise((resolve) => {
			const start = Date.now();
			const check = () => {
				const el = document.querySelector(selector);
				if (el) resolve(el);
				else if (Date.now() - start > timeout) resolve(null);
				else setTimeout(check, 200);
			};
			check();
		});
	}
	function setInputValue(el, value) {
		if (!el || !value) return;
		el.focus();
		if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
			el.value = value;
			el.dispatchEvent(new Event("input", { bubbles: true }));
			el.dispatchEvent(new Event("change", { bubbles: true }));
		} else if (el.contentEditable === "true") {
			el.innerHTML = value.replace(/\n/g, "<br>");
			el.dispatchEvent(new Event("input", { bubbles: true }));
		}
	}
	async function fill() {
		const host = window.location.hostname;
		const contentToFill = markdown ?? body ?? "";
		if (host.includes("zhihu.com")) console.log("[COSE] 知乎由导入文档功能处理");
		else if (host.includes("toutiao.com")) {
			const titleInput = await waitFor("textarea[placeholder*=\"标题\"]");
			if (titleInput) {
				titleInput.focus();
				Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(titleInput, title);
				titleInput.dispatchEvent(new InputEvent("input", {
					bubbles: true,
					data: title,
					inputType: "insertText"
				}));
				titleInput.dispatchEvent(new Event("change", { bubbles: true }));
				titleInput.dispatchEvent(new Event("blur", { bubbles: true }));
				console.log("[COSE] 头条标题填充成功:", title);
			} else console.log("[COSE] 头条未找到标题输入框");
			await new Promise((resolve) => setTimeout(resolve, 500));
			const editor = document.querySelector(".ProseMirror");
			if (editor) {
				editor.focus();
				editor.innerHTML = body || contentToFill.replace(/\n/g, "<br>");
				editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
				console.log("[COSE] 头条内容填充成功");
			} else console.log("[COSE] 头条未找到编辑器");
		} else if (host.includes("segmentfault.com")) {
			const titleInput = await waitFor("input#title, input[placeholder*=\"标题\"]");
			if (titleInput) {
				titleInput.focus();
				titleInput.value = title;
				titleInput.dispatchEvent(new Event("input", { bubbles: true }));
				titleInput.dispatchEvent(new Event("change", { bubbles: true }));
				console.log("[COSE] 思否标题填充成功");
			} else console.log("[COSE] 思否未找到标题输入框");
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			const cmElement = document.querySelector(".CodeMirror");
			if (cmElement && cmElement.CodeMirror) {
				cmElement.CodeMirror.setValue(contentToFill);
				console.log("[COSE] 思否 CodeMirror 填充成功");
			} else {
				const textarea = document.querySelector("textarea");
				if (textarea) {
					textarea.focus();
					textarea.value = contentToFill;
					textarea.dispatchEvent(new Event("input", { bubbles: true }));
					console.log("[COSE] 思否 textarea 填充成功");
				} else console.log("[COSE] 思否 未找到编辑器");
			}
		} else if (host.includes("oschina.net")) {
			const switchText = document.querySelector(".editor-switch-text");
			if (switchText && switchText.textContent.includes("切换到MD编辑器")) {
				const switchBtn = document.querySelector(".editor-switch-btn") || switchText.parentElement;
				if (switchBtn) {
					switchBtn.click();
					console.log("[COSE] OSChina 已点击切换按钮");
					let confirmBtn = null;
					for (let i = 0; i < 20; i++) {
						await new Promise((resolve) => setTimeout(resolve, 200));
						confirmBtn = Array.from(document.querySelectorAll("button")).find((btn) => btn.textContent.trim() === "确定切换");
						if (confirmBtn) break;
					}
					if (confirmBtn) {
						confirmBtn.click();
						console.log("[COSE] OSChina 已确认切换到MD编辑器");
					} else console.log("[COSE] OSChina 未找到确认切换按钮");
					await new Promise((resolve) => setTimeout(resolve, 2e3));
				}
			} else console.log("[COSE] OSChina 已在MD编辑器模式");
			const titleInput = await waitFor("input[placeholder*=\"标题\"]");
			if (titleInput) {
				titleInput.focus();
				const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
				if (nativeSetter) nativeSetter.call(titleInput, title);
				else titleInput.value = title;
				titleInput.dispatchEvent(new Event("input", { bubbles: true }));
				titleInput.dispatchEvent(new Event("change", { bubbles: true }));
				console.log("[COSE] OSChina 标题填充成功");
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
			const mdContent = markdown || contentToFill;
			let textarea = null;
			for (let i = 0; i < 10; i++) {
				textarea = document.querySelector("textarea");
				if (textarea) break;
				await new Promise((resolve) => setTimeout(resolve, 300));
			}
			if (textarea) {
				textarea.focus();
				const textareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
				if (textareaSetter) textareaSetter.call(textarea, mdContent);
				else textarea.value = mdContent;
				textarea.dispatchEvent(new Event("input", { bubbles: true }));
				textarea.dispatchEvent(new Event("change", { bubbles: true }));
				console.log("[COSE] OSChina Markdown 内容填充成功，长度:", mdContent.length);
			} else console.log("[COSE] OSChina 未找到 Markdown textarea");
		} else if (host.includes("cnblogs.com")) {
			await new Promise((resolve) => setTimeout(resolve, 1e3));
			const titleInput = await waitFor("input[placeholder=\"标题\"]") || document.querySelector("input");
			if (titleInput) {
				titleInput.focus();
				titleInput.value = title;
				titleInput.dispatchEvent(new Event("input", { bubbles: true }));
				titleInput.dispatchEvent(new Event("change", { bubbles: true }));
				console.log("[COSE] 博客园标题填充成功");
			} else console.log("[COSE] 博客园未找到标题输入框");
			await new Promise((resolve) => setTimeout(resolve, 500));
			const editor = document.querySelector("#md-editor") || document.querySelector("textarea.not-resizable");
			if (editor) {
				editor.focus();
				editor.value = contentToFill;
				editor.dispatchEvent(new Event("input", { bubbles: true }));
				editor.dispatchEvent(new Event("change", { bubbles: true }));
				console.log("[COSE] 博客园内容填充成功");
			} else console.log("[COSE] 博客园未找到编辑器");
		} else if (host.includes("infoq.cn")) {
			const titleInput = await waitFor("input[placeholder*=\"标题\"], .title-input input, input.article-title");
			if (titleInput) {
				setInputValue(titleInput, title);
				console.log("[COSE] InfoQ 标题填充成功");
			} else console.log("[COSE] InfoQ 未找到标题输入框");
			const script = document.createElement("script");
			script.textContent = `
        (async function() {
          const content = ${JSON.stringify(contentToFill)};
          
          // 等待编辑器完全初始化的函数
          const waitForEditor = () => {
            return new Promise((resolve) => {
              let attempts = 0;
              const maxAttempts = 30; // 最多等待 15 秒
              
              const check = () => {
                attempts++;
                const gkEditor = document.querySelector('.gk-editor');
                if (gkEditor && gkEditor.__vue__) {
                  const vm = gkEditor.__vue__;
                  const api = vm.editorAPI;
                  // 检查 ProseMirror view 是否就绪
                  if (api && api.editor && api.editor.view) {
                    resolve(api.editor.view);
                    return;
                  }
                }
                if (attempts < maxAttempts) {
                  setTimeout(check, 500);
                } else {
                  resolve(null);
                }
              };
              check();
            });
          };
          
          const view = await waitForEditor();
          if (!view) {
            console.log('[COSE] InfoQ 编辑器初始化超时');
            return;
          }
          
          try {
            // 清空编辑器现有内容
            const state = view.state;
            const tr = state.tr.delete(0, state.doc.content.size);
            view.dispatch(tr);
            
            // 聚焦编辑器
            view.focus();
            
            // 使用剪贴板粘贴方式插入内容（会自动解析 Markdown）
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', content);
            
            const pasteEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: clipboardData
            });
            
            view.dom.dispatchEvent(pasteEvent);
            console.log('[COSE] InfoQ 内容填充成功');
          } catch (e) {
            console.log('[COSE] InfoQ 内容填充失败:', e.message);
          }
        })();
      `;
			document.head.appendChild(script);
			script.remove();
		} else if (host.includes("jianshu.com")) {
			const titleInput = await waitFor("input._24i7u, input[class*=\"title\"]");
			if (titleInput) {
				titleInput.focus();
				Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(titleInput, title);
				titleInput.dispatchEvent(new InputEvent("input", {
					bubbles: true,
					data: title,
					inputType: "insertText"
				}));
				titleInput.dispatchEvent(new Event("change", { bubbles: true }));
				titleInput.dispatchEvent(new Event("blur", { bubbles: true }));
				console.log("[COSE] 简书标题填充成功");
			} else console.log("[COSE] 简书未找到标题输入框");
			await new Promise((resolve) => setTimeout(resolve, 500));
			const editor = document.querySelector("#arthur-editor") || document.querySelector("textarea._3swFR");
			if (editor) {
				editor.focus();
				Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(editor, contentToFill);
				editor.dispatchEvent(new InputEvent("input", {
					bubbles: true,
					data: contentToFill,
					inputType: "insertText"
				}));
				editor.dispatchEvent(new Event("change", { bubbles: true }));
				console.log("[COSE] 简书内容填充成功");
			} else console.log("[COSE] 简书未找到编辑器");
		} else if (host.includes("cloud.tencent.com")) {
			console.log("[COSE] TencentCloud 开始同步...");
			await new Promise((resolve) => setTimeout(resolve, 1500));
			/**
			* 第一步：确保进入 MD 编辑器模式
			* 检查是否有"切换 MD 编辑器"按钮：
			* - 如果有，说明当前是富文本编辑器，需要点击切换
			* - 如果没有（显示"切换 富文本 编辑器"），说明已经是 MD 编辑器
			*/
			const headerBtns = document.querySelectorAll(".header-btn");
			let needSwitch = false;
			let switchBtn = null;
			for (const btn of headerBtns) if (btn.textContent.includes("切换") && btn.textContent.includes("MD")) {
				needSwitch = true;
				switchBtn = btn;
				break;
			}
			if (needSwitch && switchBtn) {
				console.log("[COSE] TencentCloud 检测到富文本编辑器，正在切换到 MD 编辑器...");
				switchBtn.click();
				await new Promise((resolve) => setTimeout(resolve, 2e3));
			} else console.log("[COSE] TencentCloud 当前已是 MD 编辑器");
			/**
			* 第二步：等待 CodeMirror 加载完成
			*/
			let codeMirror = null;
			const maxWait = 5e3;
			const startTime = Date.now();
			while (Date.now() - startTime < maxWait) {
				const cm = document.querySelector(".CodeMirror");
				if (cm && cm.CodeMirror) {
					codeMirror = cm.CodeMirror;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			if (!codeMirror) {
				console.error("[COSE] TencentCloud 错误：CodeMirror 未加载，请刷新页面后重试");
				return;
			}
			/**
			* 第三步：填充标题
			*/
			const titleInput = document.querySelector("textarea[placeholder*=\"标题\"]");
			if (titleInput && title) {
				titleInput.focus();
				Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(titleInput, title);
				titleInput.dispatchEvent(new Event("input", { bubbles: true }));
				titleInput.dispatchEvent(new Event("change", { bubbles: true }));
				console.log("[COSE] TencentCloud 标题填充成功");
			}
			/**
			* 第四步：填充内容到 CodeMirror
			*/
			codeMirror.setValue(contentToFill);
			console.log("[COSE] TencentCloud 内容填充成功");
		} else if (host.includes("medium.com")) {
			console.log("[COSE] Medium 开始同步...");
			await new Promise((resolve) => setTimeout(resolve, 2e3));
			/**
			* 第一步：填充标题
			* Medium 的标题在 h3.graf--title 元素中
			*/
			const titleEl = document.querySelector("h3.graf--title");
			if (titleEl && title) {
				titleEl.focus();
				titleEl.textContent = title;
				titleEl.dispatchEvent(new Event("input", { bubbles: true }));
				console.log("[COSE] Medium 标题填充成功");
			}
			/**
			* 第二步：填充内容
			* Medium 使用 contenteditable 编辑器，通过 paste 事件注入 HTML 内容
			* 使用剪贴板 HTML（带完整样式）或降级到 body
			*/
			const htmlContent = wechatHtml || body || "";
			const contentEl = document.querySelector("p.graf--p");
			if (contentEl && htmlContent) {
				contentEl.focus();
				const dt = new DataTransfer();
				dt.setData("text/html", htmlContent);
				dt.setData("text/plain", htmlContent.replace(/<[^>]*>/g, ""));
				const pasteEvent = new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData: dt
				});
				contentEl.dispatchEvent(pasteEvent);
				console.log("[COSE] Medium 内容填充成功");
			}
		} else if (host.includes("mp.sohu.com")) console.log("[COSE] 搜狐号由 syncToPlatform 处理");
		else if (host.includes("modelscope.cn")) {
			console.log("[COSE] ModelScope 开始同步...");
			await new Promise((resolve) => setTimeout(resolve, 2e3));
			const textarea = document.querySelector("textarea");
			const cangjieEditor = document.querySelector("[data-cangjie-editable=\"true\"]");
			if (textarea) {
				textarea.focus();
				try {
					const clipboardData = new DataTransfer();
					clipboardData.setData("text/plain", contentToFill);
					const pasteEvent = new ClipboardEvent("paste", {
						bubbles: true,
						cancelable: true,
						clipboardData
					});
					textarea.dispatchEvent(pasteEvent);
				} catch (e) {
					Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(textarea, contentToFill);
					textarea.dispatchEvent(new InputEvent("input", {
						bubbles: true,
						data: contentToFill,
						inputType: "insertText"
					}));
				}
				textarea.dispatchEvent(new Event("change", { bubbles: true }));
				console.log("[COSE] ModelScope 内容填充成功");
				await new Promise((resolve) => setTimeout(resolve, 800));
				const findAndClickRichTextBtn = () => {
					const richTextBtn = document.querySelector("[data-testid=\"menu-item-markdownToDoc\"][data-role=\"markdownToDoc\"]");
					if (richTextBtn) {
						console.log("[COSE] ModelScope 找到\"转为富文本\"按钮，点击中...");
						richTextBtn.click();
						return true;
					}
					const allElements = document.querySelectorAll("button, span, div, a, [role=\"button\"]");
					for (const el of allElements) {
						const text = el.textContent?.trim();
						if (text === "转为富文本" || text?.includes("转为富文本")) {
							console.log("[COSE] ModelScope 找到\"转为富文本\"按钮（通过文本），点击中...");
							el.click();
							return true;
						}
					}
					return false;
				};
				let found = findAndClickRichTextBtn();
				for (let i = 0; i < 5 && !found; i++) {
					await new Promise((resolve) => setTimeout(resolve, 500));
					found = findAndClickRichTextBtn();
				}
				if (found) console.log("[COSE] ModelScope 已点击\"转为富文本\"");
				else console.log("[COSE] ModelScope 未找到\"转为富文本\"按钮（可能已自动转换）");
			} else if (cangjieEditor) {
				cangjieEditor.focus();
				document.execCommand("selectAll", false, null);
				document.execCommand("insertText", false, contentToFill);
				console.log("[COSE] ModelScope 通过 execCommand 填充");
			} else console.log("[COSE] ModelScope 未找到编辑器");
		} else {
			for (const sel of [
				"input[placeholder*=\"标题\"]",
				"input[name=\"title\"]",
				"textarea[placeholder*=\"标题\"]"
			]) {
				const el = document.querySelector(sel);
				if (el) {
					setInputValue(el, title);
					break;
				}
			}
			for (const sel of [
				".CodeMirror",
				".ProseMirror",
				".ql-editor",
				"[contenteditable=\"true\"]",
				"textarea"
			]) {
				const el = document.querySelector(sel);
				if (el) {
					if (el.CodeMirror) el.CodeMirror.setValue(contentToFill);
					else setInputValue(el, contentToFill);
					break;
				}
			}
		}
		console.log("[COSE] 内容已填充，请检查并发布");
	}
	return fill();
}
function waitForTab(tabId, timeout = 6e4) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		let urlReady = false;
		let urlReadyTime = 0;
		const check = () => {
			chrome.tabs.get(tabId, (tab) => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
					return;
				}
				if (tab.status === "complete") {
					setTimeout(resolve, 1500);
					return;
				}
				if (!urlReady && tab.url && !tab.url.startsWith("about:") && !tab.url.startsWith("chrome:")) {
					urlReady = true;
					urlReadyTime = Date.now();
				}
				if (urlReady && Date.now() - urlReadyTime > 1e4) {
					console.log("[COSE] waitForTab: 页面 URL 已就绪但 status 仍为 loading，提前继续");
					setTimeout(resolve, 1500);
					return;
				}
				if (Date.now() - start > timeout) {
					console.log("[COSE] waitForTab: 超时，继续执行");
					resolve();
				} else setTimeout(check, 300);
			});
		};
		check();
	});
}
chrome.runtime.onInstalled.addListener(() => {
	console.log("MD 文章同步助手已安装");
});
//#endregion
