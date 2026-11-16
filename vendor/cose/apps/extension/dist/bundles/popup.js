//#region src/popup.js
document.getElementById("openOfficial").addEventListener("click", (e) => {
	e.preventDefault();
	chrome.tabs.create({ url: "https://md.doocs.org" });
	window.close();
});
//#endregion
