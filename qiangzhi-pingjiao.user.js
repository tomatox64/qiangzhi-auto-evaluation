// ==UserScript==
// @name         强智教务系统自动评教(通用版)
// @namespace    https://scriptcat.org/
// @version      2.1.2
// @description  适配多所学校强智教务系统的自动评教脚本。新增可开关的全自动模式：自动识别全部未评课程→按原评分策略填充→等待可配置秒数→提交/保存→自动进入下一门。保留 Alt+Q 填充、Alt+S 提交。
// @author       小哲（Gemini-3-pro辅助开发）
// @license      MIT
// @homepageURL  https://github.com/tomatox64/qiangzhi-auto-evaluation
// @supportURL   https://github.com/tomatox64/qiangzhi-auto-evaluation/issues
// @updateURL    https://raw.githubusercontent.com/tomatox64/qiangzhi-auto-evaluation/main/qiangzhi-pingjiao.user.js
// @downloadURL  https://raw.githubusercontent.com/tomatox64/qiangzhi-auto-evaluation/main/qiangzhi-pingjiao.user.js
// @tag          自动评教
// @match        *://*/jsxsd/*
// @match        *://*/*jsxsd/*
// @match        http://192.168.100.7/*
// @icon         https://img.icons8.com/fluency/64/maintenance.png
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addElement
// @grant        CAT_scriptLoaded
// @grant        unsafeWindow
// @run-at       document-start
// @early-start
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 0. 弹窗接管 —— 必须最先执行
    //    强智提交后返回的页面常用内联 alert('保存成功') 再跳转，
    //    原生弹窗会冻结渲染线程。这里抢在页面脚本之前改写
    //    window.alert/confirm，把文案写进 DOM 供脚本读取。
    // ============================================================
    function qztAutoAtLoad() {
        try {
            const raw = GM_getValue('qzt_settings_v3');
            const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return !!(s && s.autoMode);
        } catch (e) { return false; }
    }

    function qztWriteDialog(kind, msg) {
        try {
            const d = document.documentElement;
            if (d) d.setAttribute('data-qzt-dialog', kind + ':' + String(msg).slice(0, 500) + '|' + Date.now());
        } catch (e) { /* ignore */ }
    }

    function installDialogHook() {
        const autoAtLoad = qztAutoAtLoad();
        const swallow = () => {
            try {
                const d = document.documentElement;
                if (!d) return autoAtLoad;
                const a = d.getAttribute('data-qzt-auto');
                if (a === null) return autoAtLoad;
                return a === '1' && d.getAttribute('data-qzt-confirm') !== '0';
            } catch (e) { return autoAtLoad; }
        };

        // ① 直接改写页面 window：同步生效，不依赖 GM 消息往返
        try {
            const w = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
            if (w && !w.__qztDialogHooked) {
                w.__qztDialogHooked = true;
                const origAlert = w.alert, origConfirm = w.confirm;
                w.alert = function (m) {
                    qztWriteDialog('alert', m);
                    if (swallow()) return;
                    try { return origAlert.apply(w, arguments); } catch (e) { return; }
                };
                w.confirm = function (m) {
                    qztWriteDialog('confirm', m);
                    if (swallow()) return true;
                    try { return origConfirm.apply(w, arguments); } catch (e) { return true; }
                };
                try { document.documentElement.setAttribute('data-qzt-hook', '1'); } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }

        if (hookActive()) return;

        // ② GM_addElement 注入（绕过页面 CSP）
        const code = `(function () {
            if (window.__qztDialogHooked) return;
            window.__qztDialogHooked = true;
            var origAlert = window.alert, origConfirm = window.confirm;
            function autoOn() {
                var d = document.documentElement;
                if (!d) return false;
                return d.getAttribute('data-qzt-auto') === '1' && d.getAttribute('data-qzt-confirm') !== '0';
            }
            function record(kind, msg) {
                try {
                    var d = document.documentElement;
                    d.setAttribute('data-qzt-dialog', kind + ':' + String(msg).slice(0, 500) + '|' + Date.now());
                } catch (e) {}
            }
            window.alert = function (m) {
                record('alert', m);
                if (autoOn()) return;
                try { return origAlert.apply(window, arguments); } catch (e) { return; }
            };
            window.confirm = function (m) {
                record('confirm', m);
                if (autoOn()) return true;
                try { return origConfirm.apply(window, arguments); } catch (e) { return true; }
            };
            try { document.documentElement.setAttribute('data-qzt-hook', '1'); } catch (e) {}
        })();`;

        try { GM_addElement('script', { textContent: code }); } catch (e) { /* 继续兜底 */ }
        if (hookActive()) return;

        // ③ 直接插 <script>
        try {
            const s = document.createElement('script');
            s.textContent = code;
            (document.head || document.documentElement).appendChild(s);
            s.remove();
        } catch (e) { /* 继续兜底 */ }
        if (hookActive()) return;

        // ④ 通过 unsafeWindow 在页面上下文求值
        try { unsafeWindow.eval(code); } catch (e) { /* 界面上会显示未生效 */ }
    }

    function hookActive() {
        const d = document.documentElement;
        return !!d && d.getAttribute('data-qzt-hook') === '1';
    }

    installDialogHook();

    // ============================================================
    // 0.1 样式（@early-start 下 GM_addStyle 可能尚未就绪，失败重试）
    // ============================================================
    const QZT_CSS = `
        @keyframes qzt-pulse { 0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); transform: scale(1); } 70% { box-shadow: 0 0 0 15px rgba(59, 130, 246, 0); transform: scale(1.05); } 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); transform: scale(1); } }
        .qzt-highlight-row { background-color: #eef2ff !important; border-left: 4px solid #3b82f6 !important; }
        .qzt-submit-glow { animation: qzt-pulse 2s infinite !important; outline: 3px solid #3b82f6 !important; font-weight: bold !important; }
        .qzt-btn-active { transform: scale(0.95) !important; }
        .qzt-list-unfinished { background-color: #fef2f2 !important; border-left: 4px solid #ef4444 !important; }
        .qzt-list-unfinished td { color: #b91c1c !important; }
        .qzt-dashboard-panel { position: fixed; bottom: 40px; right: 30px; z-index: 9998; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(8px); padding: 16px; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); border: 1px solid #f1f5f9; min-width: 200px; transition: opacity 0.3s ease; cursor: move; user-select: none; font-family: system-ui, sans-serif; }
        .qzt-stat-title { font-weight: 700; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 10px; font-size: 14px; display: flex; align-items: center; gap: 6px; }
        .qzt-stat-row { display: flex; justify-content: space-between; margin: 6px 0; font-size: 13px; color: #475569; }
        .qzt-stat-val { font-weight: 600; font-family: monospace; font-size: 14px; }
        .qzt-tag-ok { color: #10b981; }
        .qzt-tag-no { color: #ef4444; }
        .qzt-btn-mini { width: 100%; margin-top: 8px; padding: 5px 0; background: #e2e8f0; border: none; border-radius: 6px; cursor: pointer; color: #475569; font-size: 12px; transition: all 0.2s; }
        .qzt-btn-mini:hover { background: #3b82f6; color: white; }
        .qzt-btn-stop { background: #fee2e2; color: #b91c1c; }
        .qzt-btn-stop:hover { background: #ef4444; color: #fff; }
        .qzt-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(4px); }
        .qzt-modal { background: white; padding: 24px; border-radius: 16px; width: 400px; max-width: 90%; max-height: 86vh; overflow-y: auto; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); animation: qzt-fadein 0.3s ease-out; }
        @keyframes qzt-fadein { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .qzt-setting-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 12px 0; font-size: 13px; color: #334155; }
        .qzt-switch { position: relative; display: inline-block; width: 44px; height: 24px; flex: 0 0 auto; }
        .qzt-switch input { opacity: 0; width: 0; height: 0; }
        .qzt-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #cbd5e1; transition: .4s; border-radius: 34px; }
        .qzt-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        input:checked + .qzt-slider { background-color: #3b82f6; }
        input:checked + .qzt-slider:before { transform: translateX(20px); }
        .qzt-btn-base { border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 500; transition: opacity 0.2s; }
        .qzt-btn-save { background: #3b82f6; color: white; }
        .qzt-btn-cancel { background: #f1f5f9; color: #64748b; margin-right: 8px; }
        .qzt-select { padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; outline: none; color: #475569; background: #fff; }
        .qzt-num { width: 74px; padding: 3px 6px; border-radius: 6px; border: 1px solid #cbd5e1; outline: none; color: #475569; text-align: right; }
        .qzt-textarea { width: 100%; height: 80px; margin-top: 8px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 8px; resize: vertical; font-size: 12px; font-family: inherit; box-sizing: border-box; }
        .qzt-disclaimer-text { font-size: 13px; color: #475569; line-height: 1.6; margin: 16px 0; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px dashed #cbd5e1; }
        .qzt-disclaimer-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: bold; color: #0f172a; margin-bottom: 8px; }
        .qzt-hint { font-size: 11px; color: #94a3b8; line-height: 1.5; margin-top: -4px; }
        .qzt-auto-box { margin-top: 10px; padding: 10px; border-radius: 8px; background: #f8fafc; border: 1px dashed #cbd5e1; }
        .qzt-auto-box.on { background: #eff6ff; border-color: #93c5fd; }
        .qzt-auto-meta { font-size: 11px; color: #64748b; margin-top: 6px; line-height: 1.5; }
        .qzt-auto-meta b { color: #2563eb; }
        #qzt-auto-hud { position: fixed; top: 16px; right: 16px; z-index: 2147483000; background: rgba(15,23,42,0.94); color: #fff; border-radius: 12px; padding: 10px 14px; font-size: 13px; font-family: system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,0.25); min-width: 190px; backdrop-filter: blur(6px); }
        #qzt-auto-hud .qzt-hud-title { font-weight: 700; display: flex; align-items: center; gap: 6px; }
        #qzt-auto-hud .qzt-hud-sub { margin-top: 4px; font-size: 11px; color: #cbd5e1; }
        #qzt-auto-hud .qzt-hud-bar { height: 3px; background: rgba(255,255,255,0.18); border-radius: 3px; margin-top: 8px; overflow: hidden; }
        #qzt-auto-hud .qzt-hud-bar i { display: block; height: 100%; background: #60a5fa; width: 0; transition: width 0.25s linear; }
        #qzt-auto-hud button { margin-top: 8px; width: 100%; border: none; border-radius: 6px; padding: 4px 0; font-size: 11px; cursor: pointer; background: rgba(255,255,255,0.14); color: #fff; }
        #qzt-auto-hud button:hover { background: #ef4444; }
    `;

    function addStyles(n) {
        try { GM_addStyle(QZT_CSS); } catch (e) { if (n < 60) setTimeout(() => addStyles(n + 1), 50); }
    }
    addStyles(0);

    // ============================================================
    // 1. 常量与默认配置
    // ============================================================
    const KEY_AGREE = 'qzt_agree_v3_7';
    const KEY_POS_BTN = 'qzt_pos_btn_v3';
    const KEY_POS_PANEL = 'qzt_pos_panel_v3';
    const KEY_SETTINGS = 'qzt_settings_v3';
    const KEY_AUTO = 'qzt_auto_state_v1';

    // 原有 4 项保持不变；以下为 2.0 新增配置
    const DEFAULT_SETTINGS = {
        scoreMode: 'smart',        // 评分策略：full / smart / mixed（沿用原逻辑）
        autoSubmit: false,         // 单门模式：填充后自动提交
        overwrite: true,           // 覆盖已填写的评语
        customComments: '',        // 自定义评语库

        autoMode: false,           // 【新增】全自动模式开关
        waitSeconds: 15,           // 【新增】填充后等待秒数（网站限制，默认 15）
        submitMode: 'auto',        // 【新增】提交按钮选择：auto / submit / save
        navDelayMs: 1500,          // 【新增】进入下一门的间隔（毫秒）
        stopOnError: true,         // 【新增】出错自动暂停
        maxCourses: 40,            // 【新增】单次运行最多处理门数
        autoConfirm: true,         // 【新增】自动确认系统 alert/confirm
        skipIntro: true            // 【新增】自动跳过“评价说明”倒计时页
    };

    const AUTO_DEFAULT = {
        startedAt: 0, done: 0, fail: 0, visited: [], listUrl: '', phase: 'idle', lastMsg: '',
        baseFinished: 0, lastSubmitAt: 0, currentName: ''
    };

    const defaultComments = {
        A: ["老师授课认真，", "教学内容丰富，", "课程设计合理，", "老师治学严谨，", "授课方式新颖，", "备课非常充分，"],
        B: ["重点突出，条理清晰，", "课堂气氛活跃，", "理论联系实际，", "讲解深入浅出，", "善于引导学生思考，", "案例详实生动，"],
        C: ["我们收获很大。", "老师很有耐心。", "是一门很好的课。", "教学效果优良。", "希望能继续保持。", "对学生非常负责。"]
    };

    let batchPageHintShown = false;
    let navScheduled = false;   // 本页是否已发起跳转，防止重复进入
    let evalHandled = false;    // 本页是否已接手评价，防止重复填充
    let lastDialogStamp = 0;    // 已消费过的系统弹窗时间戳

    // ============================================================
    // 2. 基础工具
    // ============================================================
    const SafeStorage = {
        get: (key, def) => { try { return JSON.parse(GM_getValue(key)) || def; } catch (e) { return GM_getValue(key, def); } },
        set: (key, val) => GM_setValue(key, JSON.stringify(val))
    };

    function getSettings() { return Object.assign({}, DEFAULT_SETTINGS, SafeStorage.get(KEY_SETTINGS, {})); }
    function saveSettings(patch) { const s = Object.assign(getSettings(), patch); SafeStorage.set(KEY_SETTINGS, s); return s; }
    function getAuto() { const s = Object.assign({}, AUTO_DEFAULT, SafeStorage.get(KEY_AUTO, {})); if (!Array.isArray(s.visited)) s.visited = []; return s; }
    function setAuto(patch) { const s = Object.assign(getAuto(), patch); SafeStorage.set(KEY_AUTO, s); return s; }
    function resetAuto() { SafeStorage.set(KEY_AUTO, Object.assign({}, AUTO_DEFAULT, { startedAt: Date.now() })); }

    function showToast(message, duration = 4000, position = 'top') {
        const id = 'qzt-toast-' + position;
        const oldToast = document.getElementById(id); if (oldToast) oldToast.remove();
        const toast = document.createElement('div');
        toast.id = id;
        toast.innerHTML = message;
        const styles = {
            position: 'fixed', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(15, 23, 42, 0.95)',
            color: '#fff', padding: '12px 24px', borderRadius: '50px', zIndex: '2147483649', fontSize: '14px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)', pointerEvents: 'none', textAlign: 'center', backdropFilter: 'blur(4px)'
        };
        if (position === 'top') styles.top = '30px'; else styles.bottom = '80px';
        Object.assign(toast.style, styles);
        (document.body || document.documentElement).appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }

    function enableDrag(element, storageKey, onClickCallback = null) {
        let isDragging = false, startX, startY, initialLeft, initialTop;
        element.onmousedown = (e) => {
            if (e.button !== 0) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            isDragging = false; startX = e.clientX; startY = e.clientY;
            const rect = element.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top;
            element.style.bottom = 'auto'; element.style.right = 'auto'; element.style.left = initialLeft + 'px'; element.style.top = initialTop + 'px';
            const onMove = (em) => { if (Math.abs(em.clientX - startX) > 3 || Math.abs(em.clientY - startY) > 3) { isDragging = true; element.style.left = (initialLeft + em.clientX - startX) + 'px'; element.style.top = (initialTop + em.clientY - startY) + 'px'; } };
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); if (isDragging) SafeStorage.set(storageKey, { top: element.style.top, left: element.style.left }); else if (typeof onClickCallback === 'function') onClickCallback(); };
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        };
    }

    function waitFor(fn, timeout = 8000, interval = 200) {
        return new Promise((resolve) => {
            const start = Date.now();
            (function loop() {
                let v = null; try { v = fn(); } catch (e) { v = null; }
                if (v) return resolve(v);
                if (Date.now() - start > timeout) return resolve(null);
                setTimeout(loop, interval);
            })();
        });
    }

    // 让页面上下文知道当前是否处于自动模式（决定 alert/confirm 是否放行）
    function syncAutoFlag() {
        const el = document.documentElement;
        if (!el) return;
        const s = getSettings();
        el.setAttribute('data-qzt-auto', s.autoMode ? '1' : '0');
        el.setAttribute('data-qzt-confirm', s.autoConfirm ? '1' : '0');
    }

    // 读取页面上下文记录的弹窗（不消费）
    function readDialog() {
        const el = document.documentElement;
        if (!el) return null;
        const raw = el.getAttribute('data-qzt-dialog') || '';
        if (!raw) return null;
        const idx = raw.lastIndexOf('|');
        const stamp = parseInt(raw.slice(idx + 1), 10) || 0;
        if (stamp <= lastDialogStamp) return null;
        const body = raw.slice(0, idx);
        return {
            kind: /^confirm:/.test(body) ? 'confirm' : 'alert',
            msg: body.replace(/^(alert|confirm):/, ''),
            stamp
        };
    }
    function takeDialog() {
        const d = readDialog();
        if (!d) return null;
        lastDialogStamp = d.stamp;
        return d;
    }

    // ============================================================
    // 4. 评分（与原版逐行一致，不改动任何规则）
    // ============================================================
    function extractScoreFromText(text) {
        if (!text) return null;
        let match = text.match(/[（(]\s*(\d+(?:\.\d+)?)\s*(?:分)?[)）]/);
        if (match) return parseFloat(match[1]);
        match = text.match(/(\d+(?:\.\d+)?)\s*分/);
        if (match) return parseFloat(match[1]);
        match = text.match(/(?:分值|权重|分数|标准分)[:：]?\s*(\d+(?:\.\d+)?)/);
        if (match) return parseFloat(match[1]);
        return null;
    }

    function getSystemTotalScore() {
        const snapshot = document.evaluate('//*[contains(text(), "选项总分")]', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (snapshot.snapshotLength > 0) {
            for (let i = 0; i < snapshot.snapshotLength; i++) {
                const node = snapshot.snapshotItem(i);
                const text = node.innerText || node.textContent;
                const match = text.match(/选项总分[:：]?\s*(\d+(?:\.\d+)?)/);
                if (match) return parseFloat(match[1]);
            }
        }
        return null;
    }

    function calculateScore(targetRadio, groupRadios, targetIndex) {
        let container = targetRadio.parentElement;
        let text = "";
        if (targetRadio.nextSibling && targetRadio.nextSibling.nodeType === 3) text += targetRadio.nextSibling.textContent;
        if (container) text += container.innerText;
        let score = extractScoreFromText(text);
        if (score !== null) return score;
        let val = parseFloat(targetRadio.value);
        if (!isNaN(val) && val >= 0 && val <= 100) return val;
        let row = container;
        while (row && row.tagName !== 'TR') row = row.parentElement;
        if (row) {
            const rowText = row.innerText;
            const maxScore = extractScoreFromText(rowText);
            if (maxScore !== null) {
                const factors = [1.0, 0.85, 0.7, 0.5, 0.3];
                let factor = factors[targetIndex] || 0.5;
                if (groupRadios.length === 2) factor = [1.0, 0.6][targetIndex];
                return parseFloat((maxScore * factor).toFixed(1));
            }
        }
        return 0;
    }

    function generateComment(customText) {
        if (customText && customText.trim().length > 0) {
            const lines = customText.split('\n').filter(l => l.trim().length > 1);
            if (lines.length > 0) return lines[Math.floor(Math.random() * lines.length)];
        }
        const getRand = (arr) => arr[Math.floor(Math.random() * arr.length)];
        return getRand(defaultComments.A) + getRand(defaultComments.B) + getRand(defaultComments.C);
    }

    /**
     * 填充表单（原 runEvaluation 的填充部分，逻辑保持不变）
     * @returns {{count:number, total:number}}
     */
    function fillForm(settings) {
        document.querySelectorAll('.qzt-highlight-row').forEach(el => el.classList.remove('qzt-highlight-row'));

        const radios = document.querySelectorAll('input[type="radio"]');
        const groups = {};
        radios.forEach(r => { if (!groups[r.name]) groups[r.name] = []; groups[r.name].push(r); });
        const groupNames = Object.keys(groups);

        let count = 0, totalCalculatedScore = 0;
        let randomTargetIndex = settings.scoreMode === 'smart' && groupNames.length > 3 ? Math.floor(Math.random() * groupNames.length) : -1;

        groupNames.forEach((name, index) => {
            const list = groups[name];
            if (list.length === 0) return;

            let targetIndex = 0;
            if (settings.scoreMode === 'smart') {
                if (index === randomTargetIndex && list.length > 1) targetIndex = 1;
            } else if (settings.scoreMode === 'mixed') {
                if (Math.random() > 0.7 && list.length > 1) targetIndex = 1;
            }

            const target = list[targetIndex];
            if (target) {
                target.click(); target.checked = true;
                const itemScore = calculateScore(target, list, targetIndex);
                count++; totalCalculatedScore += itemScore;
                if (targetIndex > 0) {
                    let p = target.parentElement;
                    while (p && p.tagName !== 'TR') p = p.parentElement;
                    if (p) p.classList.add('qzt-highlight-row');
                }
            }
        });

        document.querySelectorAll('select').forEach(s => {
            if (s.options.length > 1) {
                s.selectedIndex = 1;
                for (let i = 0; i < s.options.length; i++) if (s.options[i].text.match(/优|A/)) s.selectedIndex = i;
                s.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        document.querySelectorAll('textarea').forEach(t => {
            if (!t.value.trim() || settings.overwrite) {
                t.value = generateComment(settings.customComments);
                t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change'));
            }
        });

        return { count, total: Math.round(totalCalculatedScore * 10) / 10 };
    }

    function modeName(mode) {
        return mode === 'full' ? '全满分' : (mode === 'mixed' ? '随机参半' : '智能扣分');
    }

    // ============================================================
    // 5. 页面识别
    // ============================================================
    function scanList() {
        const tables = document.querySelectorAll('table');
        let targetTable = null, statusColIndex = -1, nameColIndex = 0;
        for (const table of tables) {
            const headers = Array.from(table.querySelectorAll('th, tr:first-child td'));
            let hit = false;
            headers.forEach((cell, index) => {
                const t = (cell.innerText || '').replace(/\s+/g, '');
                if (t.includes('是否提交') || t.includes('提交状态')) { statusColIndex = index; hit = true; }
                if (t.includes('课程名称')) nameColIndex = index;
            });
            if (hit) { targetTable = table; break; }
        }
        if (!targetTable || statusColIndex === -1) return null;

        const rows = [];
        let total = 0, finished = 0, unfinished = 0;
        targetTable.querySelectorAll('tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length <= statusColIndex) return;
            const statusText = (cells[statusColIndex].innerText || '').trim();
            if (statusText.includes('是否提交') || statusText.includes('提交状态')) return;
            total++;
            const done = /是|yes|已提交|已完成/i.test(statusText) && !/未|否|no/i.test(statusText);
            const link = row.querySelector('a[href*="xspj_edit"], a[href*="xspj"], a');
            const nameCell = cells[nameColIndex] || cells[0];
            const name = nameCell ? nameCell.innerText.trim().replace(/\s+/g, ' ') : ('课程' + total);
            const key = link ? (link.getAttribute('href') || name) : name;
            rows.push({ row, cells, statusText, done, link, key, name });
            if (done) { finished++; row.classList.remove('qzt-list-unfinished'); }
            else { unfinished++; row.classList.add('qzt-list-unfinished'); }
        });
        return { table: targetTable, rows, total, finished, unfinished };
    }

    /**
     * 强智列表里的“评价”多为 javascript:openWindow('/jsxsd/xspj/xspj_edit.do?...',1000,700)
     * 自动模式下直接同标签打开，避免弹窗被拦截、也便于提交后回到列表。
     */
    function resolveEntryUrl(link) {
        if (!link) return '';
        const href = link.getAttribute('href') || '';
        const m = href.match(/openWindow\(\s*['"]([^'"]+)['"]/i);
        if (m) {
            try { return new URL(m[1].replace(/&amp;/g, '&'), location.href).href; } catch (e) { return ''; }
        }
        if (/^https?:/i.test(href)) return link.href;
        return '';
    }

    function detectPage() {
        const table = scanList();
        if (table) return { type: 'list', list: table };
        if (document.querySelectorAll('input[type="radio"]').length > 0) return { type: 'eval' };
        if (isIntroPage()) return { type: 'intro' };
        return { type: 'other' };
    }

    function isIntroPage() {
        const text = (document.body && document.body.innerText) || '';
        const hasNotice = /评价说明|评价须知|评教须知|评价承诺|诚信承诺|倒计时/.test(text);
        const hasEntry = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'))
            .some(el => /进入评价|开始评价|我已知晓|开始评教/.test((el.innerText || el.value || '')));
        const urlHit = /pjsm|xspj_sm|pj_sm/i.test(location.href);
        return hasEntry && (hasNotice || urlHit);
    }

    // ============================================================
    // 6. 提交按钮定位
    // ============================================================
    function resolveSubmitButton(mode) {
        const btns = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
        const visible = (b) => !!b && b.getClientRects().length > 0;
        const usable = (b) => visible(b) && !b.disabled && !/disabled/i.test(b.className || '');
        // 强智的按钮文字常写成“提  交”“保  存”，先去掉所有空白再匹配
        const textOf = (b) => ((b.value || '') + (b.innerText || '')).replace(/\s+/g, '');
        const save = document.querySelector('#btn_xspj_bc, input[name="bc"]')
            || btns.find(b => usable(b) && /保存/.test(textOf(b)) && !/保存排序/.test(textOf(b)));
        const submit = document.querySelector('#tj, input[name="tj"]')
            || btns.find(b => usable(b) && /提交/.test(textOf(b)) && !/提交状态/.test(textOf(b)));

        if (mode === 'save') return usable(save) ? save : null;
        if (mode === 'submit') return usable(submit) ? submit : (usable(save) ? save : null);
        // auto：提交优先，找不到再退回保存
        return usable(submit) ? submit : (usable(save) ? save : null);
    }

    // ============================================================
    // 7. 单门模式（原交互保持不变）
    // ============================================================
    function runEvaluation() {
        const settings = getSettings();
        const r = fillForm(settings);

        if (r.count > 0) {
            setTimeout(() => {
                const systemScore = getSystemTotalScore();
                const scoreDisplay = systemScore !== null ? `${systemScore} (系统)` : `${r.total} (脚本估算)`;
                showToast(`✅ 已填充 (${modeName(settings.scoreMode)})<br>预计得分: ${scoreDisplay}`);
                const btn = resolveSubmitButton(settings.submitMode);
                if (btn) {
                    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    btn.classList.add('qzt-submit-glow');
                    if (settings.autoSubmit) {
                        const wait = Math.max(0, Number(settings.waitSeconds) || 0);
                        showToast(`🚀 ${wait} 秒后自动提交...`);
                        beginCountdown(wait, '单门自动提交', () => { btn.click(); });
                    }
                }
            }, 100);
        } else {
            const hasRadios = document.querySelectorAll('input[type="radio"]').length > 0;
            if (!hasRadios) showToast("⚠️ 未检测到评价项，请确保在评价页面");
        }
    }

    // ============================================================
    // 8. 自动模式状态机
    // ============================================================
    function setPhase(phase, msg) {
        const st = getAuto();
        st.phase = phase;
        if (typeof msg === 'string') st.lastMsg = msg;
        setAuto(st);
    }

    function beginCountdown(seconds, label, onDone, opts) {
        const total = Math.max(0, Number(seconds) || 0);
        const abortWhenAutoOff = !!(opts && opts.abortWhenAutoOff);
        if (total <= 0) { onDone(); return; }
        const end = Date.now() + total * 1000;
        let finished = false;
        const fire = () => { if (finished) return; finished = true; onDone(); };

        if (typeof updateHud === 'function') updateHud(label, `等待 ${total} 秒（网站限制）`, 0);
        const timer = setInterval(() => {
            if (abortWhenAutoOff && !getSettings().autoMode) {
                clearInterval(timer);
                document.removeEventListener('visibilitychange', onVis);
                showToast('⏹ 自动模式已关闭，取消提交', 3000);
                return;
            }
            const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
            if (typeof updateHud === 'function') updateHud(label, `${left} 秒后自动提交`, (total - left) / total * 100);
            if (left <= 0) { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); fire(); }
        }, 250);

        // 切回前台时立即校正一次，避免后台标签页定时器被节流
        function onVis() {
            if (document.visibilityState === 'visible' && Date.now() >= end && !finished) {
                clearInterval(timer); document.removeEventListener('visibilitychange', onVis); fire();
            }
        }
        document.addEventListener('visibilitychange', onVis);
    }

    function updateHud(title, sub, percent) {
        if (!document.body) return;
        let hud = document.getElementById('qzt-auto-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'qzt-auto-hud';
            hud.innerHTML = `<div class="qzt-hud-title">🤖 自动评教</div>
                <div class="qzt-hud-sub"></div>
                <div class="qzt-hud-bar"><i></i></div>
                <button id="qzt-hud-stop">停止自动模式</button>`;
            hud.addEventListener('click', (e) => { if (e.target && e.target.id === 'qzt-hud-stop') stopAuto('已手动停止'); });
            document.body.appendChild(hud);
        }
        const subEl = hud.querySelector('.qzt-hud-sub');
        const barEl = hud.querySelector('.qzt-hud-bar i');
        const text = title + (sub ? ' · ' + sub : '');
        if (subEl.textContent !== text) subEl.textContent = text;
        if (barEl && typeof percent === 'number') barEl.style.width = Math.min(100, Math.max(0, percent)) + '%';
    }

    function removeHud() {
        const hud = document.getElementById('qzt-auto-hud');
        if (hud) hud.remove();
    }

    function startAuto() {
        const list = scanList();
        resetAuto();
        if (list) setAuto({ baseFinished: list.finished, listUrl: location.href.split('#')[0] });
        saveSettings({ autoMode: true });
        syncAutoFlag();
        navScheduled = false; evalHandled = false;
        showToast('🤖 自动模式已开启', 3000);
        setTimeout(autoTick, 300);
    }

    function stopAuto(reason) {
        saveSettings({ autoMode: false });
        syncAutoFlag();
        setPhase('idle');
        removeHud();
        if (reason) showToast('⏹ ' + reason, 4000);
        const panel = document.getElementById('qzt-stat-panel');
        if (panel) processListPage();
    }

    function finishAuto(msg) {
        const st = getAuto();
        saveSettings({ autoMode: false });
        syncAutoFlag();
        setAuto({ phase: 'idle' });
        removeHud();
        showToast(msg + `<br><span style="font-size:12px;opacity:.8">本次成功 ${st.done} 门，失败 ${st.fail} 门</span>`, 7000);
        const panel = document.getElementById('qzt-stat-panel');
        if (panel) processListPage();
    }

    function autoFail(msg, settings) {
        const st = getAuto();
        st.fail = (st.fail || 0) + 1;
        st.phase = 'error';
        st.lastMsg = msg;
        setAuto(st);
        showToast('⚠️ ' + msg, 7000);
        if (settings.stopOnError) {
            saveSettings({ autoMode: false });
            syncAutoFlag();
            setAuto({ phase: 'paused' });
            removeHud();
            showAutoAlert(msg);
        } else {
            setTimeout(goBackList, 1500);
        }
    }

    function goBackList() {
        const st = getAuto();
        if (st.listUrl) { location.href = st.listUrl; return; }
        if (document.querySelectorAll('input[type="radio"]').length > 0) history.back();
    }

    function showAutoAlert(msg) {
        if (document.querySelector('.qzt-modal-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'qzt-modal-overlay';
        overlay.innerHTML = `<div class="qzt-modal" style="width:420px;">
            <div class="qzt-disclaimer-title"><span>⚠️</span> 自动评教已暂停</div>
            <div class="qzt-disclaimer-text">系统返回：<b>${msg}</b><br><br>
            常见原因：分项答案完全相同、优秀比例超限、页面停留时间不足、登录态失效。<br>
            脚本已停止，避免反复重试触发风控。请手动确认后重新开启。</div>
            <div style="text-align:right"><button class="qzt-btn-base qzt-btn-save" id="qzt-alert-ok">知道了</button></div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#qzt-alert-ok').onclick = () => overlay.remove();
    }

    // 强智常把提交表单塞进隐藏 iframe，返回页的 alert/“保存成功”落在 iframe 文档里
    let frameDialogStamp = 0;
    function readFrameDialog() {
        const frames = document.querySelectorAll('iframe, frame');
        for (const f of frames) {
            let doc = null;
            try { doc = f.contentDocument; } catch (e) { continue; }
            if (!doc || !doc.documentElement) continue;

            const raw = doc.documentElement.getAttribute('data-qzt-dialog') || '';
            if (raw) {
                const idx = raw.lastIndexOf('|');
                const stamp = parseInt(raw.slice(idx + 1), 10) || 0;
                if (stamp > frameDialogStamp) {
                    frameDialogStamp = stamp;
                    const body = raw.slice(0, idx);
                    return {
                        kind: /^confirm:/.test(body) ? 'confirm' : 'alert',
                        msg: body.replace(/^(alert|confirm):/, '')
                    };
                }
            }
            let text = '';
            try { text = (doc.body && doc.body.innerText) || ''; } catch (e) { text = ''; }
            if (/提交成功|保存成功|操作成功|评价成功/.test(text)) {
                return { kind: 'alert', msg: '提交成功' };
            }
        }
        return null;
    }

    function isTopFrame() {
        try { return window.top === window.self; } catch (e) { return false; }
    }

    // ---- 列表页：挑下一门 ----
    function autoOnList(list, settings) {
        if (navScheduled) return;
        const st = getAuto();
        if (st.listUrl !== location.href.split('#')[0]) setAuto({ listUrl: location.href.split('#')[0] });

        // 跨页面跳转会丢内存计数，用列表里“已提交”的增量做校准
        const reconciled = Math.max(st.done || 0, list.finished - (st.baseFinished || 0));
        if (reconciled !== st.done) { st.done = reconciled; setAuto({ done: reconciled }); }

        // 上一门是“无明确提示”回来的：以列表里的提交状态为准
        if (st.phase === 'verify' && st.currentName) {
            // 提交可能还在 iframe 里跑，给它 3 秒再核对
            if (Date.now() - (st.lastSubmitAt || 0) < 3000) {
                updateHud('核对提交结果', '稍候…', 80);
                return;
            }
            const row = list.rows.find(r => r.name === st.currentName);
            setAuto({ phase: 'idle', currentName: '' });
            if (row && !row.done) {
                autoFail(`「${st.currentName}」提交后仍显示未评，已暂停`, settings);
                return;
            }
        }

        if (list.unfinished === 0) {
            finishAuto(`🎉 全部 ${list.total} 门课程均已提交`);
            return;
        }
        if (st.done + st.fail >= settings.maxCourses) {
            finishAuto(`已达单次上限 ${settings.maxCourses} 门，本次结束`);
            return;
        }

        const queue = list.rows.filter(r => !r.done);
        const next = queue.find(r => st.visited.indexOf(r.key) === -1);
        if (!next) {
            autoFail(`剩余 ${queue.length} 门课程提交后仍显示未评，请手动检查`, settings);
            return;
        }

        navScheduled = true;
        st.visited.push(next.key);
        st.phase = 'navigating';
        st.lastMsg = next.name;
        st.currentName = next.name;
        setAuto(st);
        updateHud(`第 ${st.done + 1} 门`, next.name, 0);

        setTimeout(() => {
            if (!next.link) { autoFail('该行未找到“评价”入口链接', settings); return; }
            const url = resolveEntryUrl(next.link);
            if (url) { location.href = url; return; }
            // 兜底：站点若用自定义函数打开，交给它自己处理
            next.link.click();
        }, Math.max(200, Number(settings.navDelayMs) || 1500));
    }

    // ---- 说明页：跳过 15 秒阅读倒计时 ----
    function autoOnIntro(settings) {
        if (!settings.skipIntro) {
            updateHud('等待阅读评价说明', '请在页面上手动继续', 0);
            return;
        }
        if (navScheduled) return;
        const btn = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'))
            .find(el => /进入评价|开始评价|我已知晓|开始评教/.test((el.innerText || el.value || '')));
        if (!btn) return;
        navScheduled = true;
        updateHud('评价说明页', '等待倒计时结束…', 0);
        waitFor(() => {
            const disabled = btn.disabled || /disabled/i.test(btn.className) || btn.getAttribute('aria-disabled') === 'true';
            return disabled ? null : btn;
        }, 40000, 300).then((ok) => {
            if (!ok) { navScheduled = false; autoFail('评价说明页倒计时未结束（超过 40 秒）', settings); return; }
            setTimeout(() => { try { ok.click(); } catch (e) { location.href = ok.href || location.href; } }, 300);
        });
    }

    // ---- 评价页：填充 → 等待 → 提交 → 观察结果 ----
    function autoOnEval(settings) {
        if (evalHandled) return;

        // 刚提交过又回到评价页：这是 POST 返回的页面，不能再填一遍
        const st0 = getAuto();
        const early = readDialog() || readFrameDialog();
        if (early && /成功|已保存|已提交|已完成/.test(early.msg)) {
            takeDialog();
            onAutoSuccess(early.msg);
            return;
        }
        if (st0.phase === 'submitting' && st0.lastSubmitAt && Date.now() - st0.lastSubmitAt < 45000) {
            evalHandled = true;
            updateHud('等待提交结果', '正在确认服务端返回…', 60);
            waitFor(() => {
                const d = readDialog();
                if (d && /成功|已保存|已提交|已完成/.test(d.msg)) return d;
                const f = readFrameDialog();
                if (f && /成功|已保存|已提交|已完成/.test(f.msg)) return f;
                return null;
            }, 8000, 300).then((d) => {
                if (d) { takeDialog(); onAutoSuccess(d.msg); }
                else autoFail('提交后未检测到结果，请手动确认该门是否已评', settings);
            });
            return;
        }

        evalHandled = true;
        setPhase('filling');

        // 等页面资源与站点自身的事件绑定完成，避免填完被站点脚本重置
        waitFor(() => (document.readyState === 'complete' ? true : null), 6000, 200).then(() => {
            const r = fillForm(settings);
            if (r.count === 0) { autoFail('评价页未找到可填充的题目（可能是实验课表格式）', settings); return; }

            waitFor(() => resolveSubmitButton(settings.submitMode), 6000, 300).then((btn) => {
                if (!btn) { autoFail('未找到“提交/保存”按钮', settings); return; }

                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                btn.classList.add('qzt-submit-glow');
                const wait = Math.max(0, Number(settings.waitSeconds) || 0);
                updateHud(`已填充 ${r.count} 题`, `预计 ${r.total} 分 · ${wait} 秒后提交`, 0);

                beginCountdown(wait, `已填充 ${r.count} 题`, () => {
                    btn.classList.remove('qzt-submit-glow');
                    clickAndWatch(btn, settings);
                }, { abortWhenAutoOff: true });
            });
        });
    }

    function clickAndWatch(btn, settings) {
        setPhase('submitting');
        setAuto({ lastSubmitAt: Date.now() });
        const before = location.href;
        try { btn.click(); } catch (e) { autoFail('点击提交按钮失败：' + e.message, settings); return; }

        let elapsed = 0;
        const timer = setInterval(() => {
            elapsed += 500;

            // 1) 页面已跳走：说明提交后正常返回列表
            if (location.href !== before && !/xspj_edit/i.test(location.href)) {
                clearInterval(timer);
                onAutoSuccess('页面已跳转');
                return;
            }

            // 2) 拦截到的系统提示（含隐藏 iframe 里的返回页）
            const dlg = takeDialog() || readFrameDialog();
            if (dlg) {
                // 确认框（如“提交后不能修改”）只做记录，不能当失败
                if (dlg.kind === 'confirm') {
                    showToast('💬 已自动确认：' + dlg.msg, 2500);
                } else if (/成功|已保存|已完成|已提交/.test(dlg.msg)) {
                    clearInterval(timer);
                    onAutoSuccess(dlg.msg);
                    return;
                } else if (/失败|错误|不能|无法|限制|超过|不足|请先|异常|重复|相同/.test(dlg.msg)) {
                    clearInterval(timer);
                    autoFail(dlg.msg, settings);
                    return;
                } else {
                    showToast('系统提示：' + dlg.msg, 3000);
                }
            }

            // 3) 没有明确提示：回列表用“是否提交”核对，不在这里武断判失败
            if (elapsed >= 8000) {
                clearInterval(timer);
                const bodyText = (document.body && document.body.innerText) || '';
                if (/提交成功|保存成功|评价成功/.test(bodyText)) { onAutoSuccess('页面提示成功'); return; }
                setPhase('verify');
                showToast('未捕获到明确提示，回列表核对结果…', 3000);
                setTimeout(goBackList, 600);
            }
        }, 500);
    }

    function onAutoSuccess(msg) {
        const st = getAuto();
        if (st.phase === 'done') return; // 防重入：返回页与监听器可能同时判定成功
        st.done = (st.done || 0) + 1;
        st.phase = 'done';
        st.lastMsg = msg;
        setAuto(st);
        showToast(`✅ 第 ${st.done} 门已提交`, 2500);
        updateHud(`已完成 ${st.done} 门`, '正在返回课程列表…', 100);
        setTimeout(goBackList, 700);
    }

    // ---- 总调度 ----
    let otherHandled = false;
    function autoTick() {
        if (!isTopFrame()) return; // 流程只在顶层窗口驱动，iframe 只负责上报弹窗
        const settings = getSettings();
        syncAutoFlag();
        if (!settings.autoMode) { removeHud(); return; }
        if (navScheduled) return;

        const page = detectPage();
        if (page.type === 'list') { autoOnList(page.list, settings); return; }
        if (page.type === 'intro') { autoOnIntro(settings); return; }
        if (page.type === 'eval') { autoOnEval(settings); return; }

        // 提交后的返回页可能是纯“操作成功”页：识别它，别让流程停在这里
        const st = getAuto();
        if (st.phase === 'submitting' && st.lastSubmitAt && !otherHandled) {
            otherHandled = true;
            updateHud('等待提交结果', '正在确认服务端返回…', 60);
            waitFor(() => {
                const t = (document.body && document.body.innerText) || '';
                return /提交成功|保存成功|操作成功|评价成功/.test(t) ? true : null;
            }, 8000, 300).then((ok) => {
                if (ok) onAutoSuccess('页面提示成功');
                else autoFail('提交后未检测到结果，请手动确认该门是否已评', settings);
            });
        }
    }

    // ============================================================
    // 9. 列表页看板
    // ============================================================
    function processListPage() {
        const list = scanList();
        if (!list) return;
        renderDashboard(list);
    }

    function renderDashboard(list) {
        let panel = document.getElementById('qzt-stat-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'qzt-stat-panel';
            panel.className = 'qzt-dashboard-panel';
            const savedPos = SafeStorage.get(KEY_POS_PANEL, null);
            if (savedPos) { panel.style.top = savedPos.top; panel.style.left = savedPos.left; panel.style.bottom = 'auto'; panel.style.right = 'auto'; }
            document.body.appendChild(panel);
            enableDrag(panel, KEY_POS_PANEL);
        }
        const settings = getSettings();
        const st = getAuto();
        const on = !!settings.autoMode;
        const nextLink = (list.rows.find(r => !r.done) || {}).link || null;
        const html = `
            <div class="qzt-stat-title"><span>📊</span> 评教进度 <span style="font-weight:400;font-size:11px;color:#94a3b8;margin-left:auto;">(可拖拽)</span><span id="qzt-open-settings" title="打开设置" style="cursor:pointer;font-size:13px;">⚙</span></div>
            <div class="qzt-stat-row"><span>总课程:</span> <span class="qzt-stat-val">${list.total}</span></div>
            <div class="qzt-stat-row"><span>已提交:</span> <span class="qzt-stat-val qzt-tag-ok">${list.finished}</span></div>
            <div class="qzt-stat-row"><span>未提交:</span> <span class="qzt-stat-val qzt-tag-no">${list.unfinished}</span></div>
            <div class="qzt-auto-box ${on ? 'on' : ''}">
                <div class="qzt-setting-row" style="margin:0;"><span>🤖 自动模式</span>
                    <label class="qzt-switch"><input type="checkbox" id="qzt-auto-toggle" ${on ? 'checked' : ''}><span class="qzt-slider"></span></label>
                </div>
                <div class="qzt-auto-meta">本次已自动提交 <b>${st.done}</b> 门${st.fail ? ` · 失败 <b>${st.fail}</b> 门` : ''}<br>等待 ${settings.waitSeconds}s · 上限 ${settings.maxCourses} 门 · 弹窗接管 ${hookActive() ? '<b style="color:#10b981">✓</b>' : '<b style="color:#ef4444">✗</b>'}</div>
            </div>
            ${on
                ? `<button id="qzt-btn-stop" class="qzt-btn-mini qzt-btn-stop">⏹ 停止自动评教</button>`
                : (list.unfinished > 0 && nextLink
                    ? `<button id="qzt-btn-jump" class="qzt-btn-mini">⚡ 评教下一门</button>`
                    : `<div style="text-align:center;color:#10b981;font-size:12px;margin-top:8px;">🎉 全部完成</div>`)}
        `;
        if (panel.innerHTML !== html) {
            panel.innerHTML = html;
            const toggle = document.getElementById('qzt-auto-toggle');
            if (toggle) toggle.onchange = () => {
                if (toggle.checked) { toggle.checked = false; askStartAuto(); }
                else stopAuto('自动模式已关闭');
            };
            const jump = document.getElementById('qzt-btn-jump');
            if (jump && nextLink) jump.onclick = () => { showToast("正在打开课程..."); nextLink.click(); };
            const stop = document.getElementById('qzt-btn-stop');
            if (stop) stop.onclick = () => stopAuto('已手动停止');
            const gear = document.getElementById('qzt-open-settings');
            if (gear) gear.onclick = (e) => { e.stopPropagation(); showSettings(); };
        }
    }

    function askStartAuto() {
        const list = scanList();
        if (!list) return;
        if (list.unfinished === 0) { showToast('🎉 没有待评课程'); return; }
        if (document.querySelector('.qzt-modal-overlay')) return;
        const settings = getSettings();
        const overlay = document.createElement('div');
        overlay.className = 'qzt-modal-overlay';
        const willRun = Math.min(list.unfinished, Math.max(1, Number(settings.maxCourses) || 40));
        overlay.innerHTML = `<div class="qzt-modal" style="width:430px;">
            <div class="qzt-disclaimer-title"><span>🤖</span> 开启全自动评教</div>
            <div class="qzt-disclaimer-text">
                当前有 <b>${list.unfinished}</b> 门未评，本次最多连续处理 <b>${willRun}</b> 门：<br>
                逐门进入 → 按「${modeName(settings.scoreMode)}」填充 → 等待 <b>${settings.waitSeconds}</b> 秒 → 自动${settings.submitMode === 'save' ? '保存' : '提交'} → 进入下一门。<br><br>
                <span style="color:#b91c1c">提交后通常不可修改，请确认评分策略符合你的真实意愿。</span>
            </div>
            <div style="text-align:right;">
                <button class="qzt-btn-base qzt-btn-cancel" id="qzt-auto-cancel">取消</button>
                <button class="qzt-btn-base qzt-btn-save" id="qzt-auto-ok">开始自动评教</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#qzt-auto-cancel').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        overlay.querySelector('#qzt-auto-ok').onclick = () => { overlay.remove(); startAuto(); };
    }

    // ============================================================
    // 10. 设置面板
    // ============================================================
    function showSettings() {
        if (document.querySelector('.qzt-modal-overlay')) return;
        const settings = getSettings();
        const overlay = document.createElement('div');
        overlay.className = 'qzt-modal-overlay';
        overlay.innerHTML = `
            <div class="qzt-modal">
                <h3 style="margin:0 0 15px 0; color:#1e293b; border-bottom:1px solid #e2e8f0; padding-bottom:10px;">🛠️ 评教助手设置</h3>
                <div class="qzt-setting-row"><span>📊 评分模式</span><select id="set-mode" class="qzt-select"><option value="full" ${settings.scoreMode === 'full' ? 'selected' : ''}>🚀 全满分 (100%)</option><option value="smart" ${settings.scoreMode === 'smart' ? 'selected' : ''}>⚖️ 智能扣分 (90-95%)</option><option value="mixed" ${settings.scoreMode === 'mixed' ? 'selected' : ''}>🎲 随机参半 (80-90%)</option></select></div>
                <div class="qzt-setting-row"><span>⚡ 填充后自动提交（单门）</span><label class="qzt-switch"><input type="checkbox" id="set-auto" ${settings.autoSubmit ? 'checked' : ''}><span class="qzt-slider"></span></label></div>

                <div style="margin:16px 0 6px;font-weight:600;color:#1e293b;font-size:13px;border-top:1px dashed #e2e8f0;padding-top:12px;">🤖 全自动模式</div>
                <div class="qzt-setting-row"><span>启用自动模式</span><label class="qzt-switch"><input type="checkbox" id="set-auto-mode" ${settings.autoMode ? 'checked' : ''}><span class="qzt-slider"></span></label></div>
                <div class="qzt-hint">在课程列表页开启后，会自动识别所有未评课程并逐门完成。</div>

                <div class="qzt-setting-row" style="margin-top:14px;"><span>⏱ 提交前等待（秒）</span><input type="number" min="0" max="120" step="1" id="set-wait" class="qzt-num" value="${settings.waitSeconds}"></div>
                <div class="qzt-hint">强智默认要求页面停留约 15 秒，过短会被拦截。可调 0–120。</div>

                <div class="qzt-setting-row" style="margin-top:14px;"><span>📤 提交按钮</span><select id="set-submit-mode" class="qzt-select">
                    <option value="auto" ${settings.submitMode === 'auto' ? 'selected' : ''}>自动（提交优先）</option>
                    <option value="submit" ${settings.submitMode === 'submit' ? 'selected' : ''}>仅“提交”</option>
                    <option value="save" ${settings.submitMode === 'save' ? 'selected' : ''}>仅“保存”</option>
                </select></div>

                <div class="qzt-setting-row"><span>⏭ 进入下一门间隔（毫秒）</span><input type="number" min="300" max="10000" step="100" id="set-nav" class="qzt-num" value="${settings.navDelayMs}"></div>
                <div class="qzt-setting-row"><span>🚦 单次最多处理（门）</span><input type="number" min="1" max="200" step="1" id="set-max" class="qzt-num" value="${settings.maxCourses}"></div>
                <div class="qzt-setting-row"><span>🛑 出错自动暂停</span><label class="qzt-switch"><input type="checkbox" id="set-stop" ${settings.stopOnError ? 'checked' : ''}><span class="qzt-slider"></span></label></div>
                <div class="qzt-setting-row"><span>💬 自动确认系统弹窗</span><label class="qzt-switch"><input type="checkbox" id="set-confirm" ${settings.autoConfirm ? 'checked' : ''}><span class="qzt-slider"></span></label></div>
                <div class="qzt-setting-row"><span>⏩ 跳过“评价说明”倒计时</span><label class="qzt-switch"><input type="checkbox" id="set-skip-intro" ${settings.skipIntro ? 'checked' : ''}><span class="qzt-slider"></span></label></div>

                <div style="margin-top:15px;"><span style="font-size:13px; font-weight:500;">📝 自定义评语库 (每行一条)</span><textarea id="set-comments" class="qzt-textarea" placeholder="例：\n老师讲课非常生动。\n(留空则使用内置库)">${settings.customComments || ''}</textarea></div>
                <div style="margin-top:20px; text-align:right;"><button class="qzt-btn-base qzt-btn-cancel">取消</button><button class="qzt-btn-base qzt-btn-save">保存配置</button></div>
            </div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.qzt-btn-cancel').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        overlay.querySelector('.qzt-btn-save').onclick = () => {
            const clamp = (v, min, max, def) => {
                const n = Number(v);
                if (!isFinite(n)) return def;
                return Math.min(max, Math.max(min, n));
            };
            const wantAuto = document.getElementById('set-auto-mode').checked;
            const wasAuto = settings.autoMode;
            saveSettings({
                scoreMode: document.getElementById('set-mode').value,
                autoSubmit: document.getElementById('set-auto').checked,
                overwrite: true,
                customComments: document.getElementById('set-comments').value,
                waitSeconds: clamp(document.getElementById('set-wait').value, 0, 120, 15),
                submitMode: document.getElementById('set-submit-mode').value,
                navDelayMs: clamp(document.getElementById('set-nav').value, 300, 10000, 1500),
                maxCourses: clamp(document.getElementById('set-max').value, 1, 200, 40),
                stopOnError: document.getElementById('set-stop').checked,
                autoConfirm: document.getElementById('set-confirm').checked,
                skipIntro: document.getElementById('set-skip-intro').checked
            });
            syncAutoFlag();
            showToast("✅ 设置已保存");
            close();
            const panel = document.getElementById('qzt-stat-panel');
            if (panel) processListPage();
            // 开关状态变化走统一入口：开启要确认，关闭要停表
            if (wantAuto && !wasAuto) setTimeout(askStartAuto, 200);
            else if (!wantAuto && wasAuto) stopAuto('自动模式已关闭');
            else if (getSettings().autoMode) setTimeout(autoTick, 300);
        };
    }

    // ============================================================
    // 11. 免责声明 / 悬浮按钮
    // ============================================================
    function showDisclaimer() {
        if (document.querySelector('.qzt-modal-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'qzt-modal-overlay qzt-disclaimer-modal';
        overlay.innerHTML = `
            <div class="qzt-modal" style="width: 450px;">
                <div class="qzt-disclaimer-title"><span>⚠️</span> 免责声明</div>
                <div class="qzt-disclaimer-text">
                    <p>脚本作者:<b>小哲(Gemini-3-pro辅助开发)</b></p>
                    <p>1. 本脚本仅供<b>学习和技术交流</b>使用，严禁用于任何商业或非法用途。</p>
                    <p>2. 脚本提供的自动化功能仅为辅助工具，<b>请在提交前务必核对评价内容及分数</b>。</p>
                    <p>3. 使用本脚本即代表您愿意自行承担因使用而产生的所有后果。作者不对任何损失负责。</p>
                    <p>4. 点击下方“我同意并继续”即表示您已阅读并接受本声明的所有条款。</p>
                </div>
                <div style="margin-top:20px; text-align:right;">
                    <button class="qzt-btn-base qzt-btn-cancel" id="btn-disagree">不同意 (退出)</button>
                    <button class="qzt-btn-base qzt-btn-save" id="btn-agree">我同意并继续</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        document.getElementById('btn-disagree').onclick = () => {
            overlay.innerHTML = '<div class="qzt-modal" style="text-align:center;padding:40px;">🚫<br>您拒绝了免责声明，脚本已停止运行。<br>请刷新页面重试。</div>';
        };
        document.getElementById('btn-agree').onclick = () => {
            SafeStorage.set(KEY_AGREE, true);
            showToast("✅ 欢迎使用，请理性评教", 4000, 'bottom');
            overlay.remove();
            init();
        };
    }

    function createButton() {
        if (document.getElementById('qzt-entry-btn')) return;
        const btn = document.createElement('div');
        btn.id = 'qzt-entry-btn';
        btn.innerHTML = '⚡ 一键评教';
        btn.title = "Alt+Q: 填充 | Alt+S: 提交 | 左键：自动填充 | 右键：设置";
        const pos = SafeStorage.get(KEY_POS_BTN, { top: '80%', left: '85%' });
        Object.assign(btn.style, {
            position: 'fixed', zIndex: '9999', padding: '10px 18px',
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff',
            borderRadius: '50px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.4)',
            fontWeight: '600', fontSize: '14px', top: pos.top, left: pos.left
        });
        enableDrag(btn, KEY_POS_BTN, () => { btn.classList.add('qzt-btn-active'); setTimeout(() => btn.classList.remove('qzt-btn-active'), 150); runEvaluation(); });
        btn.oncontextmenu = (e) => { e.preventDefault(); showSettings(); };
        (document.body || document.documentElement).appendChild(btn);
    }

    function processBatchPage() {
        if (batchPageHintShown) return;
        const links = Array.from(document.querySelectorAll('a'));
        const hasEntryLink = links.some(a => a.innerText.includes('进入评价'));
        const hasStatus = document.body.innerText.includes('是否提交');
        if (hasEntryLink && !hasStatus) {
            showToast("👇 点击【进入评价】才能对评价进行操作哦", 5000);
            batchPageHintShown = true;
        }
    }

    // ============================================================
    // 12. 初始化
    // ============================================================
    function init() {
        syncAutoFlag();

        const page = detectPage();
        const hasRadios = page.type === 'eval';
        const isList = page.type === 'list';
        const isIntro = page.type === 'intro';
        const isBatchPage = Array.from(document.querySelectorAll('a')).some(a => a.innerText.includes('进入评价'));

        if (!hasRadios && !isList && !isBatchPage && !isIntro) return;

        const hasAgreed = SafeStorage.get(KEY_AGREE, false);
        if (!hasAgreed) {
            if (!document.querySelector('.qzt-disclaimer-modal')) showDisclaimer();
            return;
        }

        if (hasRadios) createButton();
        if (isList) processListPage();
        if (isBatchPage && !isList) processBatchPage();

        autoTick();
    }

    // ============================================================
    // 13. 启动
    // ============================================================
    installDialogHook();
    syncAutoFlag();

    document.addEventListener('keydown', function (e) {
        if (e.altKey && (e.key === 'q' || e.key === 'Q')) {
            e.preventDefault();
            const btn = document.getElementById('qzt-entry-btn');
            if (btn) { btn.classList.add('qzt-btn-active'); setTimeout(() => btn.classList.remove('qzt-btn-active'), 150); }
            showToast("⚡ 快捷键触发: 开始填充...", 2000, 'bottom');
            runEvaluation();
        }
        if (e.altKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            const submitBtn = resolveSubmitButton('auto');
            if (submitBtn) {
                showToast("🚀 快捷键触发: 正在提交...", 2000, 'bottom');
                submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                submitBtn.classList.add('qzt-submit-glow');
                setTimeout(() => submitBtn.click(), 500);
            } else {
                showToast("⚠️ 当前页面未找到提交按钮");
            }
        }
    });

    // document-start 时 body 可能还不存在，等 DOM 就绪后再跑主循环
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { setTimeout(() => { init(); setInterval(init, 1500); }, 300); });
    } else {
        setTimeout(() => { init(); setInterval(init, 1500); }, 300);
    }

    GM_registerMenuCommand("脚本设置", showSettings);
    GM_registerMenuCommand("开启自动模式", () => { if (!getSettings().autoMode) askStartAuto(); });
    GM_registerMenuCommand("停止自动评教", () => stopAuto('已手动停止'));
    GM_registerMenuCommand("查看免责声明", () => { SafeStorage.set(KEY_AGREE, false); init(); });
})();
