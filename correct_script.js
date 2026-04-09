// ==UserScript==
// @name         高教社数据加工平台-自动纠错工具 (统计面板增强版)
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  基于 v2.4，仅在按钮左侧增加统计面板，不改动核心逻辑
// @author       Gemini
// @match        https://data.hep.com.cn/mark/taskInfo/*
// @grant        GM_xmlhttpRequest
// @connect      ！！！！！！！！！！！！请填写
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        apiKey: ' ',
        apiUrl: ' ',
        model: ' ',
        prompt: '你是一名文本识别专家，我将发给你语音转文字后的内容。请直接输出修正后的纯文本，不要有任何多余的解释。'
    };

    // --- 新增：统计数据变量 ---
    let stats = {
        success: 0,
        fail: 0,
        tokens: 0,
        startTime: null
    };

    // --- 核心功能：视频控制 (保持不变) ---
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
            video.play = originalPlay;
            originalPlay = null;
        }
    }

    // --- 核心功能：状态注入 (保持不变) ---
    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }
    }

    // --- 新增：统计面板 UI ---
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;bottom:50px;right:240px;z-index:9999;padding:12px;background:#fff;border:1px solid #1890ff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);font-size:12px;width:180px;line-height:1.6;font-family:sans-serif;';
    panel.innerHTML = `
        <div style="font-weight:bold;color:#1890ff;margin-bottom:5px;border-bottom:1px solid #eee;">实时统计</div>
        ✅ 成功: <span id="st-success">0</span><br>
        ❌ 失败: <span id="st-fail">0</span><br>
        🪙 Token: <span id="st-tokens">0</span><br>
        ⏱️ 耗时: <span id="st-time">0</span>s
    `;
    document.body.appendChild(panel);

    function updateStatsDisplay() {
        document.getElementById('st-success').innerText = stats.success;
        document.getElementById('st-fail').innerText = stats.fail;
        document.getElementById('st-tokens').innerText = Math.round(stats.tokens);
        const elapsed = stats.startTime ? ((Date.now() - stats.startTime) / 1000).toFixed(1) : 0;
        document.getElementById('st-time').innerText = elapsed;
    }

    // 创建悬浮按钮
    const btn = document.createElement('button');
    btn.innerHTML = '🐱开始全自动识别喵~';
    btn.style.cssText = 'position:fixed;bottom:50px;right:50px;z-index:9999;padding:12px 20px;background:#1890ff;color:#fff;border:none;border-radius:4px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-weight:bold;';
    document.body.appendChild(btn);

    // --- 核心功能：API 请求 (保持不变，仅增加 Token 估算) ---
    async function fetchAICorrection(text) {
        // 简单估算：中文2, 英文0.5, 基础100
        stats.tokens += (text.match(/[\u4e00-\u9fa5]/g) || []).length * 2 + (text.length * 0.5) + 100;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: CONFIG.apiUrl,
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.apiKey}` },
                data: JSON.stringify({
                    model: CONFIG.model,
                    messages: [{ role: "system", content: CONFIG.prompt }, { role: "user", content: text }],
                    temperature: 0
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        resolve(data.choices[0].message.content.trim());
                    } catch (e) { reject('解析失败'); }
                },
                onerror: () => reject('网络失败')
            });
        });
    }

    btn.onclick = async () => {
        const targets = Array.from(document.querySelectorAll('div[class*="textBox__"]'));
        if (targets.length === 0) return alert('未找到字幕块');

        // 初始化统计
        stats.success = 0; stats.fail = 0; stats.tokens = 0;
        stats.startTime = Date.now();
        const timer = setInterval(updateStatsDisplay, 500);

        btn.disabled = true;
        lockVideo();

        for (let i = 0; i < targets.length; i++) {
            const container = targets[i];
            const textNode = container.querySelector('div[class*="text__"]');
            if (!textNode) continue;

            const originalText = textNode.innerText.trim();
            if (originalText.length < 2) continue;

            try {
                btn.innerHTML = `🐱正在识别喵~(${i+1}/${targets.length})`;
                const corrected = await fetchAICorrection(originalText);

                lockVideo(); // 保持核心功能中的视频锁定

                container.scrollIntoView({ block: 'center', behavior: 'smooth' });
                const events = ['mousedown', 'mouseup', 'click', 'dblclick'];
                events.forEach(name => {
                    container.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }));
                });

                let input = null;
                for(let t = 0; t < 10; t++) {
                    await new Promise(r => setTimeout(r, 150));
                    input = container.querySelector('textarea, input') ||
                            (document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : null);
                    if (input) break;
                }

                if (input) {
                    setNativeValue(input, corrected);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));

                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    await new Promise(r => setTimeout(r, 100));
                    input.blur();

                    container.style.backgroundColor = '#f6ffed';
                    stats.success++;
                } else {
                    stats.fail++;
                }
                updateStatsDisplay();
                await new Promise(r => setTimeout(r, 400));
            } catch (e) {
                stats.fail++;
                console.error(e);
            }
        }

        clearInterval(timer);
        unlockVideo();
        updateStatsDisplay();
        btn.innerHTML = `处理完成了喵！！`;
        btn.disabled = false;
        setTimeout(() => { btn.innerHTML = '🐱 开始全自动纠错喵~'; }, 3000);
    };
})();