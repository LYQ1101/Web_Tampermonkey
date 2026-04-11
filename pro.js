// ==UserScript==
// @name         高教社数据加工平台-自动纠错工具 Pro
// @namespace    http://tampermonkey.net/
// @version      4.3
// @description  Google风格 | 一体化面板 | 性能监控 | API连通测试 | 未修改统计
// @author       Lyq
// @match        https://data.hep.com.cn/mark/taskInfo/*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // ===================== 配置存储 =====================
    const CONFIG = JSON.parse(localStorage.getItem('AI_CONFIG')) || {
        apiKey: '', apiUrl: '', model: '',
        prompt: '你是一名文本识别专家，我将发给你语音转文字后的内容。请直接输出修正后的纯文本，不要有任何多余的解释。'
    };

    // --- 统计 + 新增轻量性能数据 ---
    let stats = {
        success: 0, noChange: 0, fail: 0, tokens: 0, startTime: null,
        apiTotalTime: 0,    // API总耗时
        apiAvgTime: 0,       // 平均单次耗时
        apiCount: 0          // 请求次数
    };

    // --- 核心功能：视频控制 (完全不变) ---
    let originalPlay = null;
    function lockVideo() {
        const video = document.getElementById('myVideo');
        if (video) {
            video.pause();
            if (!originalPlay) {
                originalPlay = video.play;
                video.play = function() { return new Promise((resolve) => resolve()); };
            }
        }
    }
    function unlockVideo() {
        const video = document.getElementById('myVideo');
        if (video && originalPlay) {
            video.play = originalPlay; originalPlay = null;
        }
    }

    // --- 核心功能：状态注入 (完全不变) ---
    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) prototypeValueSetter.call(element, value);
        else if (valueSetter) valueSetter.call(element, value);
        else element.value = value;
    }

    // ===================== 通用拖动 =====================
    function makeDraggable(element) {
        let isDragging = false, startX, startY, left, top;
        element.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true; startX = e.clientX; startY = e.clientY;
            left = parseInt(window.getComputedStyle(element).left) || 0;
            top = parseInt(window.getComputedStyle(element).top) || 0;
            element.style.transition = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX, dy = e.clientY - startY;
            element.style.left = left + dx + 'px';
            element.style.top = top + dy + 'px';
            element.style.right = 'auto'; element.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => { isDragging = false; element.style.transition = 'all 0.2s ease'; });
    }

    // ===================== Google 一体化面板（新增性能显示） =====================
    const panel = document.createElement('div');
    panel.style.cssText = `
        position: fixed; bottom: 50px; right: 50px; z-index: 9999;
        width: 220px; padding: 16px; background: #fff; border-radius: 16px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08);
        font-size: 14px; line-height: 1.6;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: move; user-select: none;
        transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
        opacity: 0; transform: translateY(12px) scale(0.98); border: 1px solid #f0f0f0;
    `;
    panel.innerHTML = `
        <div style="font-weight:500; font-size:15px; color:#202124; margin-bottom:12px;">📊 自动纠错面板</div>

        <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;">
            <span>✅ 成功</span><span id="st-success" style="font-weight:500;">0</span></div>
        <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;">
            <span>📝 未修改</span><span id="st-nochange" style="font-weight:500;">0</span></div>
        <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;">
            <span>❌ 失败</span><span id="st-fail" style="font-weight:500;">0</span></div>
        <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;">
            <span>🪙 Token</span><span id="st-tokens" style="font-weight:500;">0</span></div>
        <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;">
            <span>⏱️ 总耗时</span><span id="st-time" style="font-weight:500;">0</span>s</div>
        <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;">
            <span>⚡ API 总耗时</span><span id="st-api-total" style="font-weight:500;">0</span>s</div>
        <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:12px;">
            <span>📊 平均响应</span><span id="st-api-avg" style="font-weight:500;">0</span>ms</div>

        <button id="start-btn" style="width:100%; height:40px; background:#1967d2; color:white; border:none; border-radius:8px; font-weight:500; font-size:14px; cursor:pointer; transition:all 0.2s ease; margin-bottom:8px;">
            🐱 开始全自动识别
        </button>
        <button id="open-config" style="width:100%; height:36px; background:#f1f3f4; color:#1967d2; border:none; border-radius:8px; font-size:13px; cursor:pointer; transition:all 0.2s ease;">
            ⚙️ 编辑 API 配置
        </button>
    `;
    document.body.appendChild(panel);
    makeDraggable(panel);

    // 入场动画
    setTimeout(() => { panel.style.opacity = '1'; panel.style.transform = 'translateY(0) scale(1)'; }, 200);

    // 按钮 hover
    const startBtn = document.getElementById('start-btn'), openCfgBtn = document.getElementById('open-config');
    startBtn.onmouseover = () => startBtn.style.background = '#1557b1';
    startBtn.onmouseout = () => startBtn.style.background = '#1967d2';
    openCfgBtn.onmouseover = () => openCfgBtn.style.background = '#e8e9ed';
    openCfgBtn.onmouseout = () => openCfgBtn.style.background = '#f1f3f4';

    // 超级轻量更新（500ms 一次，几乎无消耗）
    function updateStatsDisplay() {
        document.getElementById('st-success').innerText = stats.success;
        document.getElementById('st-nochange').innerText = stats.noChange;
        document.getElementById('st-fail').innerText = stats.fail;
        document.getElementById('st-tokens').innerText = Math.round(stats.tokens);
        document.getElementById('st-time').innerText = stats.startTime ? ((Date.now() - stats.startTime)/1000).toFixed(1) : 0;
        document.getElementById('st-api-total').innerText = (stats.apiTotalTime/1000).toFixed(1);
        document.getElementById('st-api-avg').innerText = stats.apiCount ? Math.round(stats.apiAvgTime) : 0;
    }

    // ===================== API 配置面板（新增：测试连通性按钮） =====================
    const configPanel = document.createElement('div');
    configPanel.style.cssText = `
        position: fixed; bottom: 50px; right: 290px; z-index: 9998;
        width: 320px; background: #fff; border-radius: 16px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.1);
        padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: move; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        opacity: 0; transform: translateY(12px) scale(0.97);
        pointer-events: none; visibility: hidden; border: 1px solid #f0f0f0;
    `;
    configPanel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div style="font-weight:500; font-size:16px; color:#202124;">⚙️ API 配置</div>
            <button id="close-config" style="background:none; border:none; font-size:18px; color:#5f6368; cursor:pointer;">✕</button>
        </div>

        <div style="margin-bottom:12px;">
            <label style="display:block; font-size:13px; color:#5f6368; margin-bottom:6px;">API Key</label>
            <input id="cfg-key" type="password" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #dadce0; border-radius:8px; font-size:14px; outline:none; transition:border-color 0.2s;" value="${CONFIG.apiKey}">
        </div>
        <div style="margin-bottom:12px;">
            <label style="display:block; font-size:13px; color:#5f6368; margin-bottom:6px;">API 地址</label>
            <input id="cfg-url" type="text" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #dadce0; border-radius:8px; font-size:14px; outline:none; transition:border-color 0.2s;" value="${CONFIG.apiUrl}">
        </div>
        <div style="margin-bottom:12px;">
            <label style="display:block; font-size:13px; color:#5f6368; margin-bottom:6px;">模型名称</label>
            <input id="cfg-model" type="text" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #dadce0; border-radius:8px; font-size:14px; outline:none; transition:border-color 0.2s;" value="${CONFIG.model}">
        </div>

        <button id="test-api" style="width:100%; height:40px; background:#34a853; color:white; border:none; border-radius:8px; font-weight:500; cursor:pointer; transition:0.2s; margin-bottom:8px;">
            🟢 测试 API 连通性
        </button>
        <button id="cfg-save" style="width:100%; height:42px; background:#1967d2; color:white; border:none; border-radius:8px; font-weight:500; cursor:pointer; transition:background 0.2s;">
            💾 保存并关闭
        </button>
    `;
    document.body.appendChild(configPanel);
    makeDraggable(configPanel);

    // 显示 / 隐藏
    function showConfig() {
        configPanel.style.opacity = '1'; configPanel.style.transform = 'translateY(0) scale(1)';
        configPanel.style.pointerEvents = 'auto'; configPanel.style.visibility = 'visible';
    }
    function hideConfig() {
        configPanel.style.opacity = '0'; configPanel.style.transform = 'translateY(12px) scale(0.97)';
        configPanel.style.pointerEvents = 'none'; setTimeout(() => configPanel.style.visibility = 'hidden', 300);
    }
    document.getElementById('open-config').onclick = showConfig;
    document.getElementById('close-config').onclick = hideConfig;

    // 保存
    document.getElementById('cfg-save').onclick = () => {
        CONFIG.apiKey = document.getElementById('cfg-key').value.trim();
        CONFIG.apiUrl = document.getElementById('cfg-url').value.trim();
        CONFIG.model = document.getElementById('cfg-model').value.trim();
        localStorage.setItem('AI_CONFIG', JSON.stringify(CONFIG));
        alert('✅ 保存成功'); hideConfig();
    };

    // 输入框聚焦
    [document.getElementById('cfg-key'), document.getElementById('cfg-url'), document.getElementById('cfg-model')].forEach(inp => {
        inp.addEventListener('focus', () => inp.style.borderColor = '#1967d2');
        inp.addEventListener('blur', () => inp.style.borderColor = '#dadce0');
    });

    // ===================== 【新增】API 连通性测试（独立异步，不影响性能） =====================
    document.getElementById('test-api').onclick = async () => {
        const key = document.getElementById('cfg-key').value.trim();
        const url = document.getElementById('cfg-url').value.trim();
        const model = document.getElementById('cfg-model').value.trim();
        if (!key || !url || !model) return alert('⚠️ 请填写完整信息');

        const btn = document.getElementById('test-api');
        btn.disabled = true; btn.innerHTML = '🔄 测试中...';

        try {
            const start = Date.now();
            const res = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST', url, headers: { 'Content-Type':'application/json', Authorization:`Bearer ${key}` },
                    data: JSON.stringify({ model, messages:[{role:'system',content:'测试'},{role:'user',content:'1'}], temperature:0 }),
                    onload: (r) => r.status >= 200 && r.status < 300 ? resolve(r) : reject('状态码异常'),
                    onerror: () => reject('网络错误')
                });
            });
            const cost = Date.now() - start;
            const data = JSON.parse(res.responseText);
            if (data.choices?.[0]?.message) alert(`🟢 API 正常！\n响应时间：${cost}ms\n模型：${model}`);
            else alert('🔴 API 返回格式异常');
        } catch (e) {
            alert(`🔴 测试失败：\n${e.toString()}`);
        } finally {
            btn.disabled = false; btn.innerHTML = '🟢 测试 API 连通性';
        }
    };

    // ===================== 核心 API 请求（新增轻量耗时统计，不影响速度） =====================
    async function fetchAICorrection(text) {
        stats.tokens += (text.match(/[\u4e00-\u9fa5]/g) || []).length * 2 + text.length * 0.5 + 100;
        const start = Date.now();
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST", url: CONFIG.apiUrl,
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.apiKey}` },
                data: JSON.stringify({ model: CONFIG.model, messages:[{role:'system',content:CONFIG.prompt},{role:'user',content:text}], temperature:0 }),
                onload: (res) => { try { resolve(JSON.parse(res.responseText).choices[0].message.content.trim()); } catch { reject('解析失败'); } },
                onerror: () => reject('网络失败')
            });
        }).finally(() => {
            // 轻量性能计算
            const cost = Date.now() - start;
            stats.apiTotalTime += cost;
            stats.apiCount++;
            stats.apiAvgTime = stats.apiTotalTime / stats.apiCount;
        });
    }

    // ===================== 启动逻辑（完全不变） =====================
    document.getElementById('start-btn').onclick = async () => {
        if (!CONFIG.apiKey || !CONFIG.apiUrl || !CONFIG.model) { alert('⚠️ 请先配置 API'); showConfig(); return; }
        const targets = Array.from(document.querySelectorAll('div[class*="textBox__"]'));
        if (!targets.length) return alert('未找到字幕块');

        stats.success = stats.noChange = stats.fail = stats.tokens = stats.apiTotalTime = stats.apiCount = stats.apiAvgTime = 0;
        stats.startTime = Date.now();
        const timer = setInterval(updateStatsDisplay, 500);
        startBtn.disabled = true; startBtn.style.background = '#8ab4f8'; startBtn.innerHTML = '🐱 正在识别...';
        lockVideo();

        for (let i = 0; i < targets.length; i++) {
            const container = targets[i];
            const textNode = container.querySelector('div[class*="text__"]');
            if (!textNode) continue;
            const originalText = textNode.innerText.trim();
            if (originalText.length < 2) continue;

            try {
                startBtn.innerHTML = `🐱 处理中 ${i+1}/${targets.length}`;
                const corrected = await fetchAICorrection(originalText);
                container.scrollIntoView({ block:'center', behavior:'smooth' });
                ['mousedown','mouseup','click','dblclick'].forEach(e => container.dispatchEvent(new MouseEvent(e,{bubbles:true})));

                let input = null;
                for(let t=0;t<10;t++) { await new Promise(r=>setTimeout(r,150)); input = container.querySelector('textarea,input') || (document.activeElement.tagName==='TEXTAREA'?document.activeElement:null); if(input) break; }

                if (input) {
                    corrected === originalText ? stats.noChange++ : stats.success++;
                    setNativeValue(input, corrected);
                    input.dispatchEvent(new Event('input',{bubbles:true}));
                    input.dispatchEvent(new Event('change',{bubbles:true}));
                    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
                    await new Promise(r=>setTimeout(r,100)); input.blur();
                    container.style.backgroundColor = '#f6ffed';
                } else stats.fail++;

                updateStatsDisplay();
                await new Promise(r=>setTimeout(r,400));
            } catch (e) { stats.fail++; console.error(e); }
        }

        clearInterval(timer); unlockVideo(); updateStatsDisplay();
        startBtn.disabled = false; startBtn.style.background = '#1967d2';
        startBtn.innerHTML = '🎉 处理完成';
        setTimeout(()=>startBtn.innerHTML='🐱 开始全自动识别',3000);
    };
})();