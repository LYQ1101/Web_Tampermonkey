// ==UserScript==
// @name         高教社数据加工平台-自动纠错工具 Flash
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description
// @author       Lyq
// @match        https://data.hep.com.cn/mark/taskInfo/*
// @grant        GM_xmlhttpRequest
// @connect      ************************************填入模型地址
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        apiKey: '***************************api密钥',
        apiUrl: '***************************模型URL',
        model: '****************************模型名称',
        prompt: '你是一名文本识别专家，我将发给你语音转文字后的内容。请直接输出修正后的纯文本，不要有任何解释。请你帮我修改错别字（同音字）和其他音频转文字的错误后，把完整的自然段发给我，注意不要自己增加或者减少内容'
    };

    /**
     * 强力同步 React 内部状态，确保输入框的值被框架识别
     */
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

    // 创建悬浮按钮
    const btn = document.createElement('button');
    btn.innerHTML = '🐱开始全自动识别喵~';
    btn.style.cssText = 'position:fixed;bottom:50px;right:50px;z-index:9999;padding:12px 20px;background:#1890ff;color:#fff;border:none;border-radius:4px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-weight:bold;';
    document.body.appendChild(btn);

    /**
     * 调用 AI 接口
     */
    async function fetchAICorrection(text) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: CONFIG.apiUrl,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${CONFIG.apiKey}`
                },
                data: JSON.stringify({
                    model: CONFIG.model,
                    messages: [{ role: "system", content: CONFIG.prompt }, { role: "user", content: text }],
                    temperature: 0.1
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.choices && data.choices[0]) {
                            resolve(data.choices[0].message.content.trim());
                        } else {
                            reject('接口未返回有效内容');
                        }
                    } catch (e) { reject('JSON解析失败'); }
                },
                onerror: () => reject('网络请求失败')
            });
        });
    }

    btn.onclick = async () => {
        // 1. 定位所有字幕容器 textBox__1BFvl
        const targets = Array.from(document.querySelectorAll('div[class*="textBox__"]'));

        if (targets.length === 0) {
            alert('未找到字幕块，请确认页面已加载且类名匹配');
            return;
        }

        btn.disabled = true;
        let count = 0;

        for (let i = 0; i < targets.length; i++) {
            const container = targets[i];
            const textNode = container.querySelector('div[class*="text__"]');
            if (!textNode) continue;

            const originalText = textNode.innerText.trim();
            if (originalText.length < 2) continue;

            try {
                btn.innerHTML = `🐱正在识别喵~(${i+1}/${targets.length})`;

                // A. 获取 AI 修正文本
                const corrected = await fetchAICorrection(originalText);

                // B. 模拟点击激活编辑态 (修复了之前的 MouseEvent 报错)
                container.scrollIntoView({ block: 'center', behavior: 'smooth' });
                const events = ['mousedown', 'mouseup', 'click', 'dblclick'];
                events.forEach(name => {
                    container.dispatchEvent(new MouseEvent(name, {
                        bubbles: true,
                        cancelable: true
                        // 移除 view: window 以解决兼容性报错
                    }));
                });

                // C. 轮询查找出现的输入框
                let input = null;
                for(let t = 0; t < 10; t++) {
                    await new Promise(r => setTimeout(r, 150));
                    // 优先级：容器内的 textarea -> 全局激活的 textarea -> ant-input
                    input = container.querySelector('textarea, input') ||
                            (document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : null) ||
                            document.querySelector('.ant-input');
                    if (input) break;
                }

                if (input) {
                    // D. 注入数据并触发更新
                    setNativeValue(input, corrected);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));

                    // 尝试回车保存
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

                    await new Promise(r => setTimeout(r, 100));
                    input.blur(); // 失去焦点触发 React 自动保存

                    // E. UI 反馈
                    container.style.backgroundColor = '#f6ffed';
                    container.style.borderLeft = '5px solid #52c41a';
                    count++;
                } else {
                    console.warn('激活失败，未找到输入框:', originalText.substring(0, 10));
                }

                // 限制频率，防止被封或接口报错
                await new Promise(r => setTimeout(r, 400));

            } catch (e) {
                console.error('处理单条记录异常:', e);
            }
        }

        btn.innerHTML = `✅ 处理完成 (成功 ${count} 条)`;
        btn.disabled = false;
        setTimeout(() => { btn.innerHTML = '🚀 开始全自动纠错'; }, 3000);
    };
})();