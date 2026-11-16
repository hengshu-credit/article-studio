//#region src/sync-sender.js
var chunkSize = 4194304;
function createSyncSender(runtime) {
	const pending = /* @__PURE__ */ new Map();
	runtime.onMessage.addListener((request, _sender, respond) => {
		if (request.type !== "READ_SYNC_CHUNK") return;
		const json = pending.get(request.id);
		if (!json || !Number.isSafeInteger(request.offset) || request.offset < 0) return;
		let end = Math.min(request.offset + chunkSize, json.length);
		const last = json.charCodeAt(end - 1);
		if (last >= 55296 && last <= 56319) end--;
		respond(json.slice(request.offset, end));
	});
	return async function sendSync(platformId, content) {
		const json = JSON.stringify(content);
		if (json.length <= chunkSize) return runtime.sendMessage({
			type: "SYNC_TO_PLATFORM",
			platformId,
			content
		});
		const id = crypto.randomUUID();
		pending.set(id, json);
		try {
			return await runtime.sendMessage({
				type: "SYNC_TO_PLATFORM",
				platformId,
				transfer: {
					id,
					length: json.length
				}
			});
		} finally {
			pending.delete(id);
		}
	};
}
//#endregion
//#region src/content.js
console.log("[COSE Content Script] Loaded!");
console.log("[COSE Content Script] URL:", window.location.href);
console.log("[COSE Content Script] Hostname:", window.location.hostname);
(function() {
	"use strict";
	if (window.location.hostname.includes("huaweicloud.com")) {
		console.log("[COSE] 检测到华为云页面");
		setTimeout(async () => {
			try {
				const response = await fetch("https://devdata.huaweicloud.com/rest/developer/fwdu/rest/developer/user/hdcommunityservice/v1/member/get-personal-info", {
					method: "GET",
					credentials: "include",
					headers: { Accept: "application/json" }
				});
				if (!response.ok) return;
				const data = await response.json();
				if (data && data.memName) {
					const userInfo = {
						loggedIn: true,
						username: data.memAlias || data.memName || "",
						avatar: data.memPhoto || "",
						cachedAt: Date.now()
					};
					if (typeof chrome !== "undefined" && chrome.runtime) chrome.runtime.sendMessage({
						type: "CACHE_USER_INFO",
						platform: "huaweicloud",
						userInfo
					}).then(() => {
						console.log("[COSE] 华为云用户信息已缓存:", userInfo.username);
					}).catch((e) => {
						console.log("[COSE] 缓存失败:", e.message);
					});
				}
			} catch (e) {
				console.log("[COSE] 华为云用户信息缓存失败:", e.message);
			}
		}, 3e3);
	}
	if (window.location.hostname.includes("developer.huawei.com")) {
		console.log("[COSE] 检测到华为开发者页面");
		setTimeout(async () => {
			try {
				const userNameEl = document.querySelector(".user_name");
				const domUsername = userNameEl ? userNameEl.textContent.trim() : "";
				const udCookie = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("developer_userdata="));
				if (!udCookie && !domUsername) return;
				let avatar = "";
				if (udCookie) {
					const udValue = decodeURIComponent(udCookie.split("=").slice(1).join("="));
					let csrfToken = "";
					try {
						const udJson = JSON.parse(udValue);
						csrfToken = udJson.csrf || udJson.csrftoken || "";
					} catch (e) {}
					if (csrfToken) {
						const hdDate = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
						try {
							const response = await fetch("https://svc-drcn.developer.huawei.com/codeserver/Common/v1/delegate", {
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
							if (response.ok) {
								const data = await response.json();
								if (data && data.returnCode === "0" && data.resJson) avatar = JSON.parse(data.resJson).headPictureURL || "";
							}
						} catch (e) {}
					}
				}
				if (domUsername || avatar) {
					const userInfo = {
						loggedIn: true,
						username: domUsername,
						avatar,
						cachedAt: Date.now()
					};
					if (typeof chrome !== "undefined" && chrome.runtime) chrome.runtime.sendMessage({
						type: "CACHE_USER_INFO",
						platform: "huaweidev",
						userInfo
					}).then(() => {
						console.log("[COSE] 华为开发者用户信息已缓存:", userInfo.username);
					}).catch((e) => {
						console.log("[COSE] 缓存失败:", e.message);
					});
				}
			} catch (e) {
				console.log("[COSE] 华为开发者用户信息缓存失败:", e.message);
			}
		}, 3e3);
	}
	if (window.location.hostname.includes("xiaohongshu.com")) {
		console.log("[COSE] 检测到小红书页面");
		setTimeout(async () => {
			try {
				console.log("[COSE] 开始获取小红书用户信息");
				const response = await fetch("https://creator.xiaohongshu.com/api/galaxy/user/info", {
					method: "GET",
					credentials: "include",
					headers: { Accept: "application/json" }
				});
				console.log("[COSE] API 响应:", response.status);
				if (!response.ok) return;
				const data = await response.json();
				console.log("[COSE] API 数据:", data?.success, data?.code);
				if (data?.success === true && data?.code === 0 && data?.data?.userId) {
					const userInfo = {
						loggedIn: true,
						username: data.data.userName || data.data.redId || "",
						avatar: data.data.userAvatar || "",
						userId: data.data.userId,
						cachedAt: Date.now()
					};
					if (typeof chrome !== "undefined" && chrome.runtime) chrome.runtime.sendMessage({
						type: "CACHE_USER_INFO",
						platform: "xiaohongshu",
						userInfo
					}).then(() => {
						console.log("[COSE] 小红书用户信息已缓存:", userInfo.username);
					}).catch((e) => {
						console.log("[COSE] 缓存失败:", e.message);
					});
					else console.log("[COSE] Chrome runtime 不可用");
				}
			} catch (e) {
				console.log("[COSE] 缓存失败:", e.message);
			}
		}, 2e3);
	}
	if (window.location.hostname.includes("alipay.com")) {
		const cacheAlipayUserInfo = async () => {
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
				if (!response.ok) return;
				const data = await response.json();
				if (data?.stat === "ok" && data?.data?.isLoginUser === 1) {
					const userInfo = {
						loggedIn: true,
						username: data.data.nickname || "",
						avatar: data.data.avatar || "",
						cachedAt: Date.now()
					};
					if (typeof chrome !== "undefined" && chrome.runtime) chrome.runtime.sendMessage({
						type: "CACHE_USER_INFO",
						platform: "alipayopen",
						userInfo
					});
					console.log("[COSE] 支付宝用户信息已缓存:", userInfo.username);
				}
			} catch (e) {
				console.log("[COSE] 支付宝用户信息缓存失败:", e.message);
			}
		};
		if (document.readyState === "complete") cacheAlipayUserInfo();
		else window.addEventListener("load", cacheAlipayUserInfo);
	}
	if (!(window.location.protocol === "http:" && ["127.0.0.1", "localhost"].includes(window.location.hostname) || window.location.origin === "https://md.doocs.org")) return;
	const sendSync = createSyncSender(chrome.runtime);
	const script = document.createElement("script");
	script.src = chrome.runtime.getURL("bundles/inject.js");
	script.onload = function() {
		this.remove();
	};
	(document.head || document.documentElement).appendChild(script);
	window.addEventListener("message", async (event) => {
		if (event.source !== window) return;
		if (!event.data || event.data.source !== "cose-page") return;
		const { type, requestId, payload } = event.data;
		try {
			let result;
			switch (type) {
				case "GET_PLATFORMS":
					result = await chrome.runtime.sendMessage({ type: "GET_PLATFORMS" });
					break;
				case "CHECK_PLATFORM_STATUS":
					result = await chrome.runtime.sendMessage({
						type: "CHECK_PLATFORM_STATUS",
						platforms: payload?.platforms
					});
					break;
				case "CHECK_PLATFORM_STATUS_PROGRESSIVE":
					result = await chrome.runtime.sendMessage({
						type: "CHECK_PLATFORM_STATUS_PROGRESSIVE",
						platforms: payload?.platforms
					});
					break;
				case "START_SYNC_BATCH":
					result = await chrome.runtime.sendMessage({ type: "START_SYNC_BATCH" });
					break;
				case "GET_DEBUG_LOGS":
					result = await chrome.runtime.sendMessage({ type: "GET_DEBUG_LOGS" });
					break;
				case "SYNC_TO_PLATFORM":
					result = await sendSync(payload.platformId, payload.content);
					break;
				default: result = { error: "Unknown type" };
			}
			window.postMessage({
				source: "cose-extension",
				requestId,
				result
			}, "*");
		} catch (error) {
			window.postMessage({
				source: "cose-extension",
				requestId,
				error: error.message
			}, "*");
		}
	});
	window.addEventListener("message", (event) => {
		if (event.source !== window) return;
		if (event.data.type === "COSE_CACHE_USER" && event.data.platform === "xiaohongshu") {
			if (typeof chrome !== "undefined" && chrome.storage) {
				console.log("[COSE] 收到缓存请求，保存用户信息");
				chrome.storage.local.set({ xiaohongshu_user: event.data.userInfo }).then(() => console.log("[COSE] 小红书用户信息已手动缓存")).catch((e) => console.log("[COSE] 缓存失败:", e));
			} else console.log("[COSE] Chrome API 不可用，无法保存缓存");
		}
	});
	chrome.runtime.onMessage.addListener((message) => {
		if (message.type === "PLATFORM_STATUS_UPDATE" || message.type === "PLATFORM_STATUS_COMPLETE") window.postMessage({
			source: "cose-extension",
			type: message.type,
			...message
		}, "*");
	});
})();
//#endregion
